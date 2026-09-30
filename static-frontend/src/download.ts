// 浏览器端下载处理：按设置的宽高缩放，转成 JPG，并写入 XMP 关键字标签。
// 移植自原项目 server/image-label.ts（sharp + @xmldom/xmldom），改用 Canvas 和浏览器自带的 DOMParser。

const XMP_HEADER = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0");
const XMP_NS = "adobe:ns:meta/";
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const DC_NS = "http://purl.org/dc/elements/1.1/";
export const DOWNLOAD_KEYWORD = "contains-synthetic-performer";

function parsePacket(packet: string): XMLDocument | null {
  try {
    // 去掉 xpacket 处理指令外的杂质后再解析
    const doc = new DOMParser().parseFromString(packet, "application/xml");
    if (!doc.documentElement || doc.getElementsByTagName("parsererror").length) return null;
    return doc;
  } catch {
    return null;
  }
}

function mergePackets(packets: string[], keyword: string) {
  const docs = packets.map(parsePacket).filter((doc): doc is XMLDocument => doc !== null);
  const doc =
    docs[0] ||
    parsePacket(`<x:xmpmeta xmlns:x="${XMP_NS}"><rdf:RDF xmlns:rdf="${RDF_NS}"><rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta>`)!;

  // 保留已有的关键字，再追加新标签
  const keywords = new Set<string>();
  for (const source of docs) {
    for (const subject of Array.from(source.getElementsByTagNameNS(DC_NS, "subject"))) {
      for (const li of Array.from(subject.getElementsByTagNameNS(RDF_NS, "li"))) {
        const text = li.textContent?.trim();
        if (text) keywords.add(text);
      }
    }
  }
  keywords.add(keyword);

  const root = doc.documentElement;
  let rdf = doc.getElementsByTagNameNS(RDF_NS, "RDF").item(0);
  if (!rdf) {
    rdf = doc.createElementNS(RDF_NS, "rdf:RDF");
    root.appendChild(rdf);
  }
  let description = rdf.getElementsByTagNameNS(RDF_NS, "Description").item(0);
  if (!description) {
    description = doc.createElementNS(RDF_NS, "rdf:Description");
    description.setAttributeNS(RDF_NS, "rdf:about", "");
    rdf.appendChild(description);
  }
  for (const subject of Array.from(doc.getElementsByTagNameNS(DC_NS, "subject"))) {
    subject.parentNode?.removeChild(subject);
  }
  const subject = doc.createElementNS(DC_NS, "dc:subject");
  const bag = doc.createElementNS(RDF_NS, "rdf:Bag");
  for (const value of keywords) {
    const li = doc.createElementNS(RDF_NS, "rdf:li");
    li.appendChild(doc.createTextNode(value));
    bag.appendChild(li);
  }
  subject.appendChild(bag);
  description.appendChild(subject);
  return `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>\n${new XMLSerializer().serializeToString(root)}\n<?xpacket end="w"?>`;
}

function startsWith(data: Uint8Array, prefix: Uint8Array, at: number) {
  if (at + prefix.length > data.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[at + i] !== prefix[i]) return false;
  return true;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** 把 XMP 关键字写入 JPG：移除原有 XMP 段，合并关键字后插入到 APPn 段之后。 */
export function injectJpegXmp(data: Uint8Array, keyword = DOWNLOAD_KEYWORD) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw new Error("图片不是有效的 JPG 文件");
  const parts: Uint8Array[] = [data.subarray(0, 2)];
  const packets: string[] = [];
  const decoder = new TextDecoder("utf-8");
  let offset = 2;
  let foundImageData = false;
  while (offset < data.length) {
    if (data[offset] !== 0xff || offset + 1 >= data.length) throw new Error("JPG 文件段格式无效");
    const marker = data[offset + 1];
    if (marker === 0xda || marker === 0xd9) {
      parts.push(data.subarray(offset));
      foundImageData = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(data.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 4 > data.length) throw new Error("JPG 文件段格式无效");
    const length = (data[offset + 2] << 8) | data[offset + 3];
    const end = offset + 2 + length;
    if (length < 2 || end > data.length) throw new Error("JPG 文件段格式无效");
    if (marker === 0xe1 && startsWith(data, XMP_HEADER, offset + 4)) {
      packets.push(decoder.decode(data.subarray(offset + 4 + XMP_HEADER.length, end)));
    } else {
      parts.push(data.subarray(offset, end));
    }
    offset = end;
  }
  if (!foundImageData) throw new Error("JPG 文件缺少图像数据");

  const payload = concat([XMP_HEADER, new TextEncoder().encode(mergePackets(packets, keyword))]);
  if (payload.length + 2 > 0xffff) throw new Error("XMP 标签过大，无法写入 JPG");
  const segment = new Uint8Array(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = ((payload.length + 2) >> 8) & 0xff;
  segment[3] = (payload.length + 2) & 0xff;
  segment.set(payload, 4);

  let insertAt = 1;
  while (insertAt < parts.length && parts[insertAt][0] === 0xff && parts[insertAt][1] >= 0xe0 && parts[insertAt][1] <= 0xef) insertAt++;
  parts.splice(insertAt, 0, segment);
  return concat(parts);
}

/** 计算输出尺寸：宽高都填则拉伸填充；只填一个则等比缩放；都不填保持原尺寸。 */
export function targetSize(srcW: number, srcH: number, width: number, height: number) {
  if (width > 0 && height > 0) return { width, height };
  if (width > 0) return { width, height: Math.max(1, Math.round((srcH * width) / srcW)) };
  if (height > 0) return { width: Math.max(1, Math.round((srcW * height) / srcH)), height };
  return { width: srcW, height: srcH };
}

async function toJpeg(source: Blob, width: number, height: number) {
  const bitmap = await createImageBitmap(source);
  try {
    const size = targetSize(bitmap.width, bitmap.height, width, height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不支持 Canvas，无法处理图片");
    // 与原服务端 flatten({ background: "#ffffff" }) 一致：透明区域填白
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 1));
    if (!blob) throw new Error("图片尺寸过大，浏览器无法导出，请调小下载宽高");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/** 准备下载文件：JPG 且无需缩放时直接写标签，否则先转 JPG（可缩放）再写标签。 */
export async function prepareDownload(source: Blob, width = 0, height = 0): Promise<Blob> {
  const bytes = new Uint8Array(await source.arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const resize = width > 0 || height > 0;
  const jpeg = isJpeg && !resize ? bytes : await toJpeg(source, width, height);
  return new Blob([injectJpegXmp(jpeg)], { type: "image/jpeg" });
}
