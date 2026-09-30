import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FileImage,
  FolderOpen,
  Gauge,
  Image as ImageIcon,
  Languages,
  LoaderCircle,
  Maximize2,
  Minus,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { downloadBlob, imageUrl, json, request } from "../api";
import {
  type Item,
  type Settings,
  type Task,
  type TaskSummary,
} from "../types";

const initialSettings: Settings = {
  geminiBaseUrl: "",
  geminiModel: "gemini-2.5-flash",
  geminiAuth: "bearer",
  geminiAuthHeader: "",
  geminiKeySet: false,
  extraInstruction: "",
  imageBaseUrl: "https://task-api-1-cn.65535.space",
  imageModel: "gpt-image-2",
  imageKeySet: false,
  size: "",
  resolution: "",
  quality: "",
  downloadWidth: 0,
  downloadHeight: 0,
  checkModel: false,
  promptConcurrency: 2,
  imageConcurrency: 2,
  pollSeconds: 2,
  timeoutMinutes: 30,
  autoPrompt: true,
  autoGenerate: false,
};
const stageText: Record<Item["promptStatus"], string> = {
  idle: "待处理",
  pending: "排队中",
  running: "处理中",
  done: "已完成",
  failed: "失败",
};
const imageText: Record<Item["imageStatus"], string> = {
  idle: "待生成",
  pending: "排队中",
  running: "生成中",
  done: "已生成",
  failed: "失败",
};
const checkText: Record<Item["validationStatus"], string> = {
  idle: "未校验",
  pending: "校验中",
  passed: "通过",
  failed: "未通过",
  unknown: "无法判断",
  error: "校验失败",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function apiError(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

export function App() {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [task, setTask] = useState<Task | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [language, setLanguage] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [downloadSelectedIds, setDownloadSelectedIds] = useState<string[]>([]);
  const [downloadWidth, setDownloadWidth] = useState(0);
  const [downloadHeight, setDownloadHeight] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [secretDraft, setSecretDraft] = useState({
    geminiKey: "",
    imageKey: "",
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState<{
    type: "error" | "success" | "info";
    text: string;
  } | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [zoom, setZoom] = useState(1);
  const [compare, setCompare] = useState(50);
  const [fitTick, setFitTick] = useState(0);

  const loadSettings = useCallback(async () => {
    try {
      const next = await request<Settings>("/api/config");
      setSettings(next);
      setDownloadWidth(next.downloadWidth);
      setDownloadHeight(next.downloadHeight);
    } catch (error) {
      setNotice({ type: "error", text: apiError(error) });
    }
  }, []);
  const loadTasks = useCallback(async () => {
    try {
      setTasks(await request<TaskSummary[]>("/api/tasks"));
    } catch {
      /* The server may still be starting. */
    }
  }, []);
  const loadTask = useCallback(async (id: string) => {
    try {
      const next = await request<Task>(`/api/tasks/${id}`);
      setTask(next);
      setSelectedId(id);
      setSelectedItemId((current) =>
        next.items.some((item) => item.id === current)
          ? current
          : next.items[0]?.id || "",
      );
    } catch (error) {
      setNotice({ type: "error", text: apiError(error) });
    }
  }, []);
  useEffect(() => {
    void loadSettings();
    void (async () => {
      try {
        const latest = (await request<TaskSummary[]>("/api/tasks"))[0];
        if (latest) {
          setLanguage(latest.language);
          await loadTask(latest.id);
        } else await loadTasks();
      } catch {
        await loadTasks();
      }
    })();
  }, [loadSettings, loadTasks, loadTask]);
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setInterval(() => void loadTask(selectedId), 1800);
    return () => window.clearInterval(timer);
  }, [selectedId, loadTask]);
  useEffect(() => {
    if (task && !selectedItemId && task.items[0])
      setSelectedItemId(task.items[0].id);
  }, [task, selectedItemId]);
  useEffect(() => {
    setZoom(1);
    setCompare(50);
    setFitTick((value) => value + 1);
  }, [selectedItemId]);

  const selectedItem =
    task?.items.find((item) => item.id === selectedItemId) || task?.items[0];
  const donePrompts =
    task?.items.filter((item) => item.promptStatus === "done").length || 0;
  const doneImages =
    task?.items.filter((item) => item.imageStatus === "done").length || 0;
  const doneChecks =
    task?.items.filter((item) => item.validationStatus === "passed").length ||
    0;
  const anyRunning = !!task?.busy;
  const completedItems = task?.items.filter((item) => item.imageStatus === "done" && item.hasResult) || [];
  const allImagesReady = !!task && completedItems.length === task.items.length && task.items.length > 0;

  const showNotice = (type: "error" | "success" | "info", text: string) => {
    setNotice({ type, text });
    window.setTimeout(
      () => setNotice((current) => (current?.text === text ? null : current)),
      4500,
    );
  };
  async function runAction(label: string, action: () => Promise<void>) {
    setBusyAction(label);
    try {
      await action();
    } catch (error) {
      showNotice("error", apiError(error));
    } finally {
      setBusyAction("");
    }
  }
  async function refreshTask() {
    if (selectedId) await loadTask(selectedId);
    await loadTasks();
  }
  async function createTask(files: FileList | File[]) {
    if (!language.trim()) {
      showNotice("error", "请先填写目标语言");
      return;
    }
    const imageFiles = [...files].filter(isSupportedImage);
    if (!imageFiles.length) {
      showNotice("error", "没有找到支持的图片");
      return;
    }
    await runAction("上传中", async () => {
      const body = new FormData();
      body.append("language", language.trim());
      imageFiles.forEach((file) =>
        body.append(
          "files",
          file,
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
            file.name,
        ),
      );
      const next = await request<Task>("/api/tasks", { method: "POST", body });
      setTask(next);
      setSelectedId(next.id);
      setSelectedItemId(next.items[0]?.id || "");
      await loadTasks();
      showNotice("success", `已加入 ${next.items.length} 张图片`);
    });
  }
  async function appendImages(files: FileList | File[]) {
    if (!task) return;
    const imageFiles = [...files].filter(isSupportedImage);
    if (!imageFiles.length) {
      showNotice("error", "没有找到支持的图片");
      return;
    }
    await runAction("追加图片", async () => {
      const body = new FormData();
      imageFiles.forEach((file) =>
        body.append(
          "files",
          file,
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
            file.name,
        ),
      );
      const next = await request<Task>(`/api/tasks/${task.id}/items`, {
        method: "POST",
        body,
      });
      const previousIds = new Set(task.items.map((item) => item.id));
      const firstAdded = next.items.find((item) => !previousIds.has(item.id));
      setTask(next);
      if (firstAdded) setSelectedItemId(firstAdded.id);
      await loadTasks();
      showNotice("success", `已追加 ${next.items.length - task.items.length} 张图片`);
    });
  }
  async function deleteItem(itemId: string) {
    if (!task) return;
    setDownloadSelectedIds((ids) => ids.filter((id) => id !== itemId));
    const item = task.items.find((candidate) => candidate.id === itemId);
    if (!item || !window.confirm(`确定删除“${item.name}”吗？`)) return;
    await runAction("删除图片", async () => {
      const next = await request<Task>(
        `/api/tasks/${task.id}/items/${itemId}`,
        { method: "DELETE" },
      );
      setTask(next);
      setSelectedItemId((current) =>
        current === itemId ? next.items[0]?.id || "" : current,
      );
      await loadTasks();
      showNotice("success", "图片已删除");
    });
  }
  function toggleDownload(itemId: string) {
    setDownloadSelectedIds((ids) => ids.includes(itemId) ? ids.filter((id) => id !== itemId) : [...ids, itemId]);
  }
  async function saveDownloadSize() {
    try {
      const current = await request<Settings>("/api/config");
      await request<Settings>("/api/config", json("PUT", {
        ...current,
        downloadWidth,
        downloadHeight,
      })).then(setSettings);
    } catch (error) {
      showNotice("error", apiError(error));
    }
  }
  async function downloadImages(ids = downloadSelectedIds) {
    if (!task) return;
    const available = task.items.filter((item) => item.imageStatus === "done" && item.hasResult);
    const chosen = ids.map((id) => available.find((item) => item.id === id)).filter((item): item is Item => !!item);
    if (!chosen.length) { showNotice("info", "没有可下载的已生成图片"); return; }
    const currentTask = task;
    await runAction("准备下载", async () => {
      const timestamp = Date.now();
      for (const [index, item] of chosen.entries()) {
        // 在浏览器内按宽高缩放、转 JPG 并写入 XMP 标签
        const blob = await downloadBlob(currentTask.id, item.id, downloadWidth, downloadHeight);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `img_${timestamp + index}.jpg`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        // 延迟释放，避免浏览器还没开始下载就被回收
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        // 连续触发多个下载时留出间隔，避免被浏览器拦截
        if (index < chosen.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
    });
  }
  async function savePrompt(prompt: string) {
    if (!task || !selectedItem) return;
    await runAction("保存提示词", async () => {
      const next = await request<Task>(
        `/api/tasks/${task.id}/items/${selectedItem.id}/prompt`,
        { ...json("PATCH", { prompt }) },
      );
      setTask(next);
      showNotice("success", "提示词已保存");
    });
  }
  async function saveSettings() {
    await runAction("保存设置", async () => {
      const payload = {
        ...settings,
        ...Object.fromEntries(
          Object.entries(secretDraft).filter(([, value]) => value),
        ),
      } as Record<string, unknown>;
      const next = await request<Settings>("/api/config", json("PUT", payload));
      setSettings(next);
      setSettingsOpen(false);
      showNotice("success", "设置已保存");
    });
  }
  async function handleSettingsChange(
    next: Settings & { geminiKey?: string; imageKey?: string },
  ) {
    setSettings(next);
  }
  async function generatePrompts() {
    if (!task) return;
    await runAction("生成提示词", async () => {
      const next = await request<Task>(
        `/api/tasks/${task.id}/prompts/generate`,
        json("POST"),
      );
      setTask(next);
    });
  }
  async function generateImages() {
    if (!task) return;
    await runAction("生成图片", async () => {
      const next = await request<Task>(
        `/api/tasks/${task.id}/images/generate`,
        json("POST"),
      );
      setTask(next);
    });
  }
  async function regeneratePrompt(itemId: string) {
    if (!task) return;
    await runAction("重新识别", async () => {
      const next = await request<Task>(
        `/api/tasks/${task.id}/items/${itemId}/prompt/regenerate`,
        json("POST"),
      );
      setTask(next);
    });
  }
  async function regenerateImage(itemId: string) {
    if (!task) return;
    await runAction("重新生成", async () => {
      const next = await request<Task>(
        `/api/tasks/${task.id}/items/${itemId}/image/regenerate`,
        json("POST"),
      );
      setTask(next);
    });
  }
  async function validate() {
    if (!task) return;
    await runAction("校验中", async () => {
      const next = await request<Task>(
        `/api/tasks/${task.id}/validate`,
        json("POST"),
      );
      setTask(next);
    });
  }
  async function deleteCurrent() {
    if (!task) return;
    await runAction("删除任务", async () => {
      await request(`/api/tasks/${task.id}`, { method: "DELETE" });
      setTask(null);
      setSelectedId("");
      setSelectedItemId("");
      await loadTasks();
    });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Languages size={18} />
          </div>
          <div>
            <div className="brand-name">译图</div>
            <div className="brand-sub">IMAGE TRANSLATION WORKBENCH</div>
          </div>
        </div>
        <div className="topbar-context">
          <span className="context-label">目标语言</span>
          <input
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            placeholder="例如：日语、韩语、简体中文"
            aria-label="目标语言"
          />
          <span className="context-count">
            {task ? `${task.items.length} 张图片` : "未创建任务"}
          </span>
        </div>
        <div className="topbar-actions">
          <button
            className="icon-button"
            title="任务历史"
            onClick={() => setHistoryOpen(true)}
          >
            <Archive size={18} />
          </button>
          <button
            className="button button-quiet"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={16} /> 设置
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="upload-strip">
          <DropZone onFiles={createTask} />
          <div className="upload-guide">
            <div className="guide-kicker">
              <Sparkles size={15} /> 本机处理
            </div>
            <h1>把画面里的文字，换成另一种语言。</h1>
            <p>
              拖入图片或整组文件夹。原图、译文稿和成品会留在同一个任务里，方便逐张复核。
            </p>
          </div>
          <div className="language-note">
            <Target size={17} />
            <span>
              先填写目标语言
              <br />
              <strong>{language || "等待输入"}</strong>
            </span>
          </div>
        </section>
        <div className="workbench-grid">
          <aside className="panel source-panel">
            <PanelHeading
              icon={<FileImage size={16} />}
              title="原图队列"
              meta={task ? `${task.items.length} 张` : "尚未导入"}
            />
            <div className="panel-scroll">
              {task ? (
                task.items.map((item, index) => (
                  <ImageRow
                    key={item.id}
                    taskId={task.id}
                    item={item}
                    index={index}
                    selected={selectedItem?.id === item.id}
                    onClick={() => setSelectedItemId(item.id)}
                    onDelete={() => deleteItem(item.id)}
                    downloadable={item.imageStatus === "done" && item.hasResult}
                    downloadSelected={downloadSelectedIds.includes(item.id)}
                    onToggleDownload={() => toggleDownload(item.id)}
                    disabled={anyRunning || !!busyAction}
                  />
                ))
              ) : (
                <EmptyQueue onFiles={createTask} />
              )}
            </div>
            {task && (
              <>
              <div className="panel-foot">
                <span className="tiny-muted">
                  创建于 {formatTime(task.createdAt)}
                </span>
                <button
                  className="text-button danger-text"
                  onClick={deleteCurrent}
                  disabled={anyRunning || !!busyAction}
                >
                  <Trash2 size={14} /> 删除任务
                </button>
              </div>
              <div className="panel-add">
                <AppendImagesButton
                  onFiles={appendImages}
                  disabled={anyRunning || !!busyAction}
                />
                <div className="download-actions">
                  <button className="button button-outline" onClick={() => downloadImages()} disabled={!downloadSelectedIds.length || !!busyAction}><Download size={14} /> 下载选中</button>
                  <button className="button button-outline" onClick={() => downloadImages(completedItems.map((item) => item.id))} disabled={!allImagesReady || !!busyAction}><Download size={14} /> 全部下载</button>
                </div>
                <div className="download-size-controls" aria-label="下载尺寸设置">
                  <label>宽 <input type="number" min="0" max="20000" value={downloadWidth} onChange={(event) => setDownloadWidth(Math.max(0, Math.min(20000, Number(event.target.value) || 0)))} onBlur={() => void saveDownloadSize()} /></label>
                  <span>×</span>
                  <label>高 <input type="number" min="0" max="20000" value={downloadHeight} onChange={(event) => setDownloadHeight(Math.max(0, Math.min(20000, Number(event.target.value) || 0)))} onBlur={() => void saveDownloadSize()} /></label>
                  <small>0 保持原尺寸</small>
                </div>
              </div>
              </>
            )}
          </aside>
          <section className="panel prompt-panel">
            <PanelHeading
              icon={<Sparkles size={16} />}
              title="翻译提示词"
              meta={
                selectedItem ? stageText[selectedItem.promptStatus] : "等待选择"
              }
            />
            {selectedItem ? (
              <PromptEditor
                item={selectedItem}
                taskId={task!.id}
                busy={!!busyAction || anyRunning}
                onSave={savePrompt}
                onRegenerate={() => regeneratePrompt(selectedItem.id)}
              />
            ) : (
              <EmptyPrompt />
            )}
          </section>
          <section className="panel result-panel">
            <PanelHeading
              icon={<ImageIcon size={16} />}
              title="翻译后的图片"
              meta={
                selectedItem ? imageText[selectedItem.imageStatus] : "等待生成"
              }
            />
            {selectedItem && task ? (
              <CompareViewer
                taskId={task.id}
                item={selectedItem}
                compare={compare}
                setCompare={setCompare}
                zoom={zoom}
                setZoom={setZoom}
                fitTick={fitTick}
                onDownload={() => downloadImages([selectedItem.id])}
                onRegenerate={() => regenerateImage(selectedItem.id)}
                busy={anyRunning || !!busyAction}
              />
            ) : (
              <EmptyResult />
            )}
          </section>
        </div>
        <TaskRail
          task={task}
          donePrompts={donePrompts}
          doneImages={doneImages}
          doneChecks={doneChecks}
          busyAction={busyAction}
          settings={settings}
          onGeneratePrompts={generatePrompts}
          onGenerateImages={generateImages}
          onValidate={validate}
          onRefresh={refreshTask}
        />
      </main>
      {notice && (
        <div className={`toast toast-${notice.type}`}>
          <span>
            {notice.type === "error" ? (
              <CircleAlert size={17} />
            ) : (
              <CheckCircle2 size={17} />
            )}
          </span>
          {notice.text}
          <button className="toast-close" onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          setSettings={handleSettingsChange}
          secrets={secretDraft}
          setSecrets={setSecretDraft}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          busy={!!busyAction}
        />
      )}
      {historyOpen && (
        <HistoryDrawer
          tasks={tasks}
          activeId={selectedId}
          onSelect={(id) => {
            void loadTask(id);
            setHistoryOpen(false);
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

function PanelHeading({
  icon,
  title,
  meta,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
}) {
  return (
    <div className="panel-heading">
      <span className="heading-icon">{icon}</span>
      <h2>{title}</h2>
      <span className="heading-meta">{meta}</span>
    </div>
  );
}
function isSupportedImage(file: File) {
  const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (supportedTypes.has(file.type.toLowerCase())) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

function DropZone({
  onFiles,
}: {
  onFiles: (files: FileList | File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  async function readDroppedItems(items: DataTransferItemList, fallback?: FileList) {
    const files: File[] = [];
    const visit = async (
      entry: FileSystemEntry,
      prefix = "",
    ): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        Object.defineProperty(file, "webkitRelativePath", {
          value: `${prefix}${file.name}`,
          configurable: true,
        });
        files.push(file);
        return;
      }
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children: FileSystemEntry[] = [];
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        children.push(...batch);
      }
      await Promise.all(
        children.map((child) => visit(child, `${prefix}${entry.name}/`)),
      );
    };
    await Promise.all(
      Array.from(items).map((item) => {
        const entry = item.webkitGetAsEntry?.();
        return entry ? visit(entry) : Promise.resolve();
      }),
    );
    if (files.length) onFiles(files);
    else if (fallback?.length) onFiles(fallback);
  }
  return (
    <div
      className={`drop-zone ${over ? "is-over" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (event.dataTransfer.items.length)
          void readDroppedItems(event.dataTransfer.items, event.dataTransfer.files);
        else if (event.dataTransfer.files.length)
          onFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) onFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={folder}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        {...({
          webkitdirectory: "",
          directory: "",
        } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(event) => {
          if (event.target.files) onFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <div className="drop-icon">
        <Upload size={24} />
      </div>
      <div className="drop-title">拖入图片开始</div>
      <div className="drop-subtitle">支持 PNG、JPG、WebP、GIF</div>
      <div className="drop-actions">
        <button
          className="button button-dark"
          onClick={() => input.current?.click()}
        >
          <FileImage size={15} /> 选择图片
        </button>
        <button
          className="button button-outline"
          onClick={() => folder.current?.click()}
        >
          <FolderOpen size={15} /> 选择文件夹
        </button>
      </div>
    </div>
  );
}
function ImageRow({
  item,
  index,
  selected,
  onClick,
  taskId,
  onDelete,
  downloadable,
  downloadSelected,
  onToggleDownload,
  disabled,
}: {
  item: Item;
  index: number;
  selected: boolean;
  onClick: () => void;
  taskId: string;
  onDelete: () => void;
  disabled: boolean;
  downloadable: boolean;
  downloadSelected: boolean;
  onToggleDownload: () => void;
}) {
  return (
    <div className={`image-row ${selected ? "is-selected" : ""}`}>
      <button className="image-row-main" onClick={onClick}>
      <div className="row-number">{String(index + 1).padStart(2, "0")}</div>
      <div className="row-thumb">
        <img
          src={imageUrl(taskId, item.id, "source")}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
        <FileImage size={20} />
      </div>
      <div className="row-info">
        <strong title={item.relativePath}>{item.name}</strong>
        <span title={item.relativePath}>{item.relativePath}</span>
        <div className="row-state">
          <span
            className={`dot dot-${item.promptStatus === "done" ? "green" : item.promptStatus === "failed" ? "red" : "grey"}`}
          />
          <span>
            {item.promptStatus === "done"
              ? item.imageStatus === "done"
                ? "已完成"
                : "已识别"
              : stageText[item.promptStatus]}
          </span>
        </div>
      </div>
      </button>
      <div className="image-row-actions">
        {downloadable && <label className="row-download-label"><input type="checkbox" checked={downloadSelected} onChange={onToggleDownload} aria-label={`选择下载 ${item.name}`} /> 选择</label>}
        <button className="image-row-delete" title="删除图片" onClick={onDelete} disabled={disabled}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
function EmptyQueue({
  onFiles,
}: {
  onFiles: (files: FileList | File[]) => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-symbol">
        <ImageIcon size={22} />
      </div>
      <strong>这里会出现你的图片</strong>
      <p>从上方拖入文件，或者选择一个文件夹。</p>
    </div>
  );
}
function EmptyPrompt() {
  return (
    <div className="empty-state compact">
      <div className="empty-symbol">
        <Sparkles size={20} />
      </div>
      <strong>选择一张图片</strong>
      <p>生成后的翻译提示词会在这里编辑。</p>
    </div>
  );
}
function EmptyResult() {
  return (
    <div className="empty-state compact">
      <div className="empty-symbol">
        <PanelRight size={20} />
      </div>
      <strong>等待翻译成品</strong>
      <p>先生成提示词，再开始图片生成。</p>
    </div>
  );
}

function PromptEditor({
  item,
  taskId,
  busy,
  onSave,
  onRegenerate,
}: {
  item: Item;
  taskId: string;
  busy: boolean;
  onSave: (prompt: string) => Promise<void>;
  onRegenerate: () => void;
}) {
  const [value, setValue] = useState(item.prompt);
  const [savedValue, setSavedValue] = useState(item.prompt);
  useEffect(() => {
    setValue(item.prompt);
    setSavedValue(item.prompt);
  }, [item.id, item.prompt]);
  const changed = value !== savedValue;
  return (
    <div className="prompt-editor">
      <div className="selected-file">
        <div className="file-chip">
          <FileImage size={15} />
          <span title={item.relativePath}>{item.name}</span>
        </div>
        <span className={`status-chip status-${item.promptStatus}`}>
          {stageText[item.promptStatus]}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="生成后会在这里显示逐行翻译提示词，你也可以直接修改。"
        disabled={busy}
        spellCheck={false}
      />
      <div className="editor-meta">
        <span>{value.length} 字符</span>
        {changed && <span className="unsaved">有未保存修改</span>}
      </div>
      <div className="editor-actions">
        <button
          className="button button-dark"
          onClick={() => {
            void onSave(value).then(() => setSavedValue(value));
          }}
          disabled={busy || !value.trim()}
        >
          <Save size={15} /> 保存提示词
        </button>
        <button
          className="button button-outline"
          onClick={onRegenerate}
          disabled={busy}
        >
          <RefreshCw size={15} /> 重新识别
        </button>
      </div>
      <div className="prompt-tip">
        <SlidersHorizontal size={14} />
        <span>
          Gemini 只负责逐行翻译；生成图片时会把这段文字作为编辑指令传入。
        </span>
      </div>
    </div>
  );
}
function CompareViewer({
  taskId,
  item,
  compare,
  setCompare,
  zoom,
  setZoom,
  fitTick,
  onDownload,
  onRegenerate,
  busy,
}: {
  taskId: string;
  item: Item;
  compare: number;
  setCompare: (value: number) => void;
  zoom: number;
  setZoom: (value: number) => void;
  fitTick: number;
  onDownload: () => void;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"compare" | "source" | "result">("compare");
  const frame = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const comparisonDrag = useRef(false);
  const updateCompare = (clientX: number) => {
    const rect = frame.current?.getBoundingClientRect();
    if (rect)
      setCompare(
        Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      );
  };
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [fitTick, item.id]);
  useEffect(() => {
    const canvas = frame.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom(
        Math.min(3, Math.max(0.25, zoom + (event.deltaY < 0 ? 0.1 : -0.1))),
      );
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [zoom, setZoom]);
  const source = imageUrl(taskId, item.id, "source");
  const result = imageUrl(taskId, item.id, "result", item.version);
  const canCompare = item.hasResult;
  function move(event: React.PointerEvent) {
    if (!drag.current) return;
    setOffset({
      x: drag.current.ox + event.clientX - drag.current.x,
      y: drag.current.oy + event.clientY - drag.current.y,
    });
  }
  return (
    <div className="viewer-shell">
      <div className="viewer-toolbar">
        <div className="segmented">
          <button
            className={mode === "compare" ? "active" : ""}
            onClick={() => setMode("compare")}
            disabled={!canCompare}
          >
            对比
          </button>
          <button
            className={mode === "source" ? "active" : ""}
            onClick={() => setMode("source")}
          >
            原图
          </button>
          <button
            className={mode === "result" ? "active" : ""}
            onClick={() => setMode("result")}
            disabled={!canCompare}
          >
            结果
          </button>
        </div>
        <div className="viewer-tools">
          <button
            className="icon-button small"
            title="缩小"
            onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}
          >
            <ZoomOut size={15} />
          </button>
          <span className="zoom-value">{Math.round(zoom * 100)}%</span>
          <button
            className="icon-button small"
            title="放大"
            onClick={() => setZoom(Math.min(3, zoom + 0.1))}
          >
            <ZoomIn size={15} />
          </button>
          <button
            className="icon-button small"
            title="重置视图"
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
      <div
        className={`viewer-canvas ${item.imageStatus === "done" ? "" : "is-empty"}`}
        ref={frame}
        onPointerDown={(event) => {
          if (event.button === 0) {
            frame.current?.setPointerCapture(event.pointerId);
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              ox: offset.x,
              oy: offset.y,
            };
          }
        }}
        onPointerMove={(event) => move(event)}
        onPointerUp={() => {
          drag.current = null;
          comparisonDrag.current = false;
        }}
        onPointerCancel={() => {
          drag.current = null;
          comparisonDrag.current = false;
        }}
      >
        <div className="checkerboard" />
        {mode === "source" || (mode === "compare" && !canCompare) ? (
          <img
            className="viewer-image source-image"
            src={source}
            style={{
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
            }}
            draggable={false}
          />
        ) : mode === "result" ? (
          <img
            className="viewer-image"
            src={result}
            style={{
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
            }}
            draggable={false}
          />
        ) : (
          <>
            <img
              className="viewer-image"
              src={source}
              style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
              }}
              draggable={false}
            />
            <div
              className="result-clip"
              style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }}
            >
              <img
                className="viewer-image"
                src={result}
                style={{
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
                }}
                draggable={false}
              />
            </div>
            <div
              className="compare-line"
              onPointerMove={(event) => {
                event.stopPropagation();
                if (comparisonDrag.current) updateCompare(event.clientX);
              }}
              style={{ left: `${compare}%` }}
              onPointerDown={(event) => {
                event.stopPropagation();
                comparisonDrag.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                updateCompare(event.clientX);
              }}
              onPointerUp={() => { comparisonDrag.current = false; }}
              onPointerCancel={() => { comparisonDrag.current = false; }}
            >
              <span>
                <ChevronLeft size={12} />
                <ChevronRight size={12} />
              </span>
            </div>
          </>
        )}
        {!canCompare && (
          <div className="viewer-placeholder">
            <div className="viewer-placeholder-icon">
              {item.imageStatus === "failed" ? (
                <CircleAlert size={24} />
              ) : item.imageStatus === "running" ? (
                <LoaderCircle size={24} className="spin" />
              ) : (
                <ImageIcon size={24} />
              )}
            </div>
            <strong>
              {item.imageStatus === "failed"
                ? "生成失败"
                : item.imageStatus === "running"
                  ? "图片生成中"
                  : "尚未生成结果"}
            </strong>
            <p>{item.error || "完成提示词后，点击底部的生成图片。"}</p>
          </div>
        )}
      </div>
      <div className="compare-caption">
        <span>原图</span>
        {canCompare && (
          <input
            aria-label="对比线位置"
            type="range"
            min="0"
            max="100"
            value={compare}
            onChange={(event) => setCompare(Number(event.target.value))}
          />
        )}
        {canCompare && <span>翻译图</span>}
      </div>
      {item.error && (
        <div className="viewer-error">
          <CircleAlert size={14} /> {item.error}
        </div>
      )}
      {item.hasResult && (
        <div className={`validation-line validation-${item.validationStatus}`}>
          <CheckCircle2 size={14} /> {checkText[item.validationStatus]}
          {item.validationReason ? `：${item.validationReason}` : ""}
        </div>
      )}
      {item.promptStatus === "done" && (
        <button
          className="button button-outline regenerate-button"
          onClick={onRegenerate}
          disabled={busy}
        >
          <RefreshCw size={14} /> {item.hasResult ? "重新生成此图" : "生成此图"}
        </button>
      )}
      {item.hasResult && (
        <button className="download-button" onClick={onDownload}>
          <Download size={15} /> 下载当前图片
        </button>
      )}
    </div>
  );
}

function TaskRail({
  task,
  donePrompts,
  doneImages,
  doneChecks,
  busyAction,
  settings,
  onGeneratePrompts,
  onGenerateImages,
  onValidate,
  onRefresh,
}: {
  task: Task | null;
  donePrompts: number;
  doneImages: number;
  doneChecks: number;
  busyAction: string;
  settings: Settings;
  onGeneratePrompts: () => void;
  onGenerateImages: () => void;
  onValidate: () => void;
  onRefresh: () => void;
}) {
  const count = task?.items.length || 0;
  const allPrompts = count > 0 && donePrompts === count;
  const allImages = count > 0 && doneImages === count;
  const allChecks = count > 0 && doneChecks === count;
  return (
    <section className="task-rail">
      <div className="rail-copy">
        <div className="rail-kicker">
          <Gauge size={15} /> 任务进度
        </div>
        <strong>
          {task ? `${doneImages} / ${count} 张已完成` : "准备好开始"}
        </strong>
        <div className="progress-track">
          <span
            style={{ width: `${count ? (doneImages / count) * 100 : 0}%` }}
          />
        </div>
      </div>
      <div className="rail-steps">
        <span className={donePrompts === count && count ? "complete" : ""}>
          <i>1</i> 翻译提示词
        </span>
        <span className={allImages ? "complete" : ""}>
          <i>2</i> 生成图片
        </span>
        <span className={allChecks ? "complete" : ""}>
          <i>3</i> 一键校验
        </span>
      </div>
      <div className="rail-actions">
        <button
          className="button button-outline"
          onClick={onRefresh}
          disabled={!task || !!busyAction}
        >
          <RefreshCw size={15} /> 刷新
        </button>
        <button
          className="button button-dark"
          onClick={onGeneratePrompts}
          disabled={!task || !!busyAction || allPrompts}
        >
          <Sparkles size={15} />{" "}
          {busyAction === "生成提示词"
            ? "生成中…"
            : allPrompts
              ? "提示词已完成"
              : "生成提示词"}
        </button>
        <button
          className="button button-copper"
          onClick={onGenerateImages}
          disabled={!task || !!busyAction || !allPrompts || allImages}
        >
          <Play size={15} />{" "}
          {busyAction === "生成图片" ? "生成中…" : "生成图片"}
        </button>
        <button
          className="button button-outline"
          onClick={onValidate}
          disabled={!task || !!busyAction || !allImages || allChecks}
        >
          <Check size={15} />{" "}
          {busyAction === "校验中"
            ? "校验中…"
            : allChecks
              ? "校验完成"
              : "校验全部"}
        </button>
      </div>
    </section>
  );
}

function SettingsModal({
  settings,
  setSettings,
  secrets,
  setSecrets,
  onClose,
  onSave,
  busy,
}: {
  settings: Settings;
  setSettings: (
    settings: Settings & { geminiKey?: string; imageKey?: string },
  ) => void;
  secrets: { geminiKey: string; imageKey: string };
  setSecrets: (value: { geminiKey: string; imageKey: string }) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const update = (patch: Partial<Settings>) =>
    setSettings({ ...settings, ...patch });
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="settings-modal">
        <div className="modal-head">
          <div>
            <div className="modal-kicker">
              <Settings2 size={14} /> 本机配置
            </div>
            <h2>接口与处理设置</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="settings-scroll">
          <SettingsGroup title="Gemini 翻译接口" marker="01">
            <Field
              label="Base URL"
              hint="填写中转站根地址，支持包含 /v1beta 的地址"
            >
              <input
                value={settings.geminiBaseUrl}
                onChange={(e) => update({ geminiBaseUrl: e.target.value })}
                placeholder="https://your-relay.example.com"
              />
            </Field>
            <div className="field-grid">
              <Field label="模型">
                <input
                  value={settings.geminiModel}
                  onChange={(e) => update({ geminiModel: e.target.value })}
                  placeholder="gemini-2.5-flash"
                />
              </Field>
              <Field label="鉴权方式">
                <select
                  value={settings.geminiAuth}
                  onChange={(e) =>
                    update({
                      geminiAuth: e.target.value as Settings["geminiAuth"],
                    })
                  }
                >
                  <option value="bearer">Authorization: Bearer</option>
                  <option value="google">x-goog-api-key</option>
                  <option value="custom">自定义请求头</option>
                </select>
              </Field>
            </div>
            {settings.geminiAuth === "custom" && (
              <Field label="自定义请求头名称">
                <input
                  value={settings.geminiAuthHeader}
                  onChange={(e) => update({ geminiAuthHeader: e.target.value })}
                  placeholder="X-API-Key"
                />
              </Field>
            )}
            <Field
              label="API Key"
              hint={
                settings.geminiKeySet
                  ? "已保存密钥，留空则保持不变"
                  : "只保存在本机服务端"
              }
            >
              <input
                type="password"
                value={secrets.geminiKey}
                onChange={(e) =>
                  setSecrets({ ...secrets, geminiKey: e.target.value })
                }
                placeholder={
                  settings.geminiKeySet ? "••••••••••••" : "填写 Gemini API Key"
                }
              />
            </Field>
            <Field
              label="追加要求"
              hint="核心指令“翻译为目标语言，输出‘原文’替换为‘译文’，分行，不用列表”始终保留"
            >
              <textarea
                className="settings-textarea"
                value={settings.extraInstruction}
                onChange={(e) => update({ extraInstruction: e.target.value })}
                placeholder="例如：品牌名保持英文，语气简洁。"
              />
            </Field>
          </SettingsGroup>
          <SettingsGroup title="图片生成接口" marker="02">
            <Field label="Base URL">
              <input
                value={settings.imageBaseUrl}
                onChange={(e) => update({ imageBaseUrl: e.target.value })}
                placeholder="https://task-api-1-cn.65535.space"
              />
            </Field>
            <div className="field-grid">
              <Field label="模型">
                <input
                  value={settings.imageModel}
                  onChange={(e) => update({ imageModel: e.target.value })}
                  placeholder="gpt-image-2"
                />
              </Field>
              <Field
                label="API Key"
                hint={settings.imageKeySet ? "已保存密钥，留空则保持不变" : ""}
              >
                <input
                  type="password"
                  value={secrets.imageKey}
                  onChange={(e) =>
                    setSecrets({ ...secrets, imageKey: e.target.value })
                  }
                  placeholder={
                    settings.imageKeySet
                      ? "••••••••••••"
                      : "填写图片生成 API Key"
                  }
                />
              </Field>
            </div>
            <div className="field-grid three">
              <Field label="尺寸">
                <input
                  value={settings.size}
                  onChange={(e) => update({ size: e.target.value })}
                  placeholder="例如 16:9"
                />
              </Field>
              <Field label="分辨率">
                <input
                  value={settings.resolution}
                  onChange={(e) => update({ resolution: e.target.value })}
                  placeholder="例如 2k"
                />
              </Field>
              <Field label="质量">
                <input
                  value={settings.quality}
                  onChange={(e) => update({ quality: e.target.value })}
                  placeholder="按模型支持填写"
                />
              </Field>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.checkModel}
                onChange={(e) => update({ checkModel: e.target.checked })}
              />
              <span>提交前校验模型在线状态与图片权限</span>
            </label>
          </SettingsGroup>
          <SettingsGroup title="任务节奏" marker="03">
            <div className="field-grid four">
              <Field label="提示词并发">
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={settings.promptConcurrency}
                  onChange={(e) =>
                    update({ promptConcurrency: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="生图并发">
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={settings.imageConcurrency}
                  onChange={(e) =>
                    update({ imageConcurrency: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="轮询间隔（秒）">
                <input
                  type="number"
                  min="2"
                  max="30"
                  value={settings.pollSeconds}
                  onChange={(e) =>
                    update({ pollSeconds: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="超时（分钟）">
                <input
                  type="number"
                  min="2"
                  max="180"
                  value={settings.timeoutMinutes}
                  onChange={(e) =>
                    update({ timeoutMinutes: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.autoPrompt}
                onChange={(e) => update({ autoPrompt: e.target.checked })}
              />
              <span>导入图片后自动生成翻译提示词</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.autoGenerate}
                onChange={(e) => update({ autoGenerate: e.target.checked })}
              />
              <span>全部提示词完成后自动开始生图</span>
            </label>
          </SettingsGroup>
        </div>
        <div className="modal-foot">
          <span className="settings-footnote">
            <CheckCircle2 size={14} /> 密钥只存储在本机 data/config.json
          </span>
          <div>
            <button className="button button-outline" onClick={onClose}>
              取消
            </button>
            <button
              className="button button-dark"
              onClick={onSave}
              disabled={busy}
            >
              <Save size={15} /> 保存设置
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
function SettingsGroup({
  title,
  marker,
  children,
}: {
  title: string;
  marker: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-group">
      <div className="group-heading">
        <span>{marker}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </div>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}
function HistoryDrawer({
  tasks,
  activeId,
  onSelect,
  onClose,
}: {
  tasks: TaskSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="history-drawer">
        <div className="drawer-head">
          <div>
            <div className="modal-kicker">
              <Archive size={14} /> 本地任务
            </div>
            <h2>历史任务</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="history-list">
          {tasks.length ? (
            tasks.map((task) => (
              <button
                key={task.id}
                className={`history-item ${activeId === task.id ? "active" : ""}`}
                onClick={() => onSelect(task.id)}
              >
                <div>
                  <strong>{task.language}</strong>
                  <span>{formatTime(task.createdAt)}</span>
                </div>
                <span>
                  {task.done} / {task.count} 张
                </span>
              </button>
            ))
          ) : (
            <div className="empty-state">
              <div className="empty-symbol">
                <Archive size={20} />
              </div>
              <strong>还没有历史任务</strong>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
function AppendImagesButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: FileList | File[]) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) onFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <div
        className={`append-drop ${over ? "is-over" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setOver(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (!disabled && event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
        }}
      >
        <button className="button button-outline append-button" onClick={() => input.current?.click()} disabled={disabled}>
          <Plus size={15} /> 追加图片
        </button>
        <span>或将图片拖到这里</span>
      </div>
    </>
  );
}

