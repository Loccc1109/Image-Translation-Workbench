export const DOWNLOAD_KEYWORD = "contains-synthetic-performer";
const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";
const XMP_HEADER_BYTES = new TextEncoder().encode(XMP_HEADER);
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const XMP_NS = "adobe:ns:meta/";

function parsePacket(packet: string): Document | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(packet, "application/xml");
    if (!doc.documentElement || doc.getElementsByTagName("parsererror").length > 0) {
      return null;
    }
    return doc;
  } catch {
    return null;
  }
}

function mergePackets(packets: string[], keyword: string): string {
  const docs = packets.map(parsePacket).filter((doc): doc is Document => doc !== null);
  const doc =
    docs[0] ||
    new DOMParser().parseFromString(
      `<x:xmpmeta xmlns:x="${XMP_NS}"><rdf:RDF xmlns:rdf="${RDF_NS}"><rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta>`,
      "application/xml",
    );

  const keywords = new Set<string>();
  for (const source of docs) {
    for (const subject of Array.from(source.getElementsByTagNameNS(DC_NS, "subject"))) {
      for (const li of Array.from(subject.getElementsByTagNameNS(RDF_NS, "li"))) {
        if (li.textContent?.trim()) {
          keywords.add(li.textContent.trim());
        }
      }
    }
  }
  keywords.add(keyword);

  const root = doc.documentElement;
  if (!root) throw new Error("XMP 元数据缺少根节点");

  let rdf = doc.getElementsByTagNameNS(RDF_NS, "RDF").item(0);
  if (!rdf) {
    rdf = doc.createElementNS(RDF_NS, "rdf:RDF");
    root.appendChild(rdf);
  }

  let description = doc.getElementsByTagNameNS(RDF_NS, "Description").item(0);
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

  return `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>\n${new XMLSerializer().serializeToString(doc)}\n<?xpacket end="w"?>`;
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function matchesHeader(data: Uint8Array, offset: number, header: Uint8Array): boolean {
  if (offset + header.length > data.length) return false;
  for (let i = 0; i < header.length; i++) {
    if (data[offset + i] !== header[i]) return false;
  }
  return true;
}

export function injectJpegXmp(data: Uint8Array, keyword = DOWNLOAD_KEYWORD): Uint8Array {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    throw new Error("图片不是有效的 JPG 文件");
  }

  const parts: Uint8Array[] = [data.subarray(0, 2)];
  const packets: string[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 2;

  while (offset < data.length) {
    if (data[offset] !== 0xff || offset + 1 >= data.length) {
      throw new Error("JPG 文件段格式无效");
    }
    const marker = data[offset + 1];
    if (marker === 0xda || marker === 0xd9) {
      parts.push(data.subarray(offset));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(data.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 4 > data.length) {
      throw new Error("JPG 文件段格式无效");
    }
    const length = view.getUint16(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > data.length) {
      throw new Error("JPG 文件段格式无效");
    }

    if (marker === 0xe1 && matchesHeader(data, offset + 4, XMP_HEADER_BYTES)) {
      const packetBytes = data.subarray(offset + 4 + XMP_HEADER_BYTES.length, end);
      const packet = new TextDecoder("utf-8").decode(packetBytes).replace(/\0+$/, "");
      if (parsePacket(packet)) {
        packets.push(packet);
      } else {
        parts.push(data.subarray(offset, end));
      }
    } else {
      parts.push(data.subarray(offset, end));
    }
    offset = end;
  }

  if (offset >= data.length) {
    throw new Error("JPG 文件缺少图像数据");
  }

  const xmlPacket = mergePackets(packets, keyword);
  const xmlBytes = new TextEncoder().encode(xmlPacket);
  const payload = concatUint8Arrays([XMP_HEADER_BYTES, xmlBytes]);
  if (payload.length + 2 > 0xffff) {
    throw new Error("XMP 标签过大，无法写入 JPG");
  }

  const segment = new Uint8Array(payload.length + 4);
  const segView = new DataView(segment.buffer);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segView.setUint16(2, payload.length + 2);
  segment.set(payload, 4);

  let insertAt = 1;
  while (
    insertAt < parts.length &&
    parts[insertAt][0] === 0xff &&
    parts[insertAt][1] >= 0xe0 &&
    parts[insertAt][1] <= 0xef
  ) {
    insertAt++;
  }
  parts.splice(insertAt, 0, segment);
  return concatUint8Arrays(parts);
}
