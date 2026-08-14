import { Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import type {
  CreateNavigationItem,
  NavigationAccent,
  NavigationItem,
} from "../../shared/contracts/navigation";
import { createNavigation } from "../api";
import { normalizeHttpUrl } from "../url-normalize";

const accentLabels: Record<NavigationAccent, string> = {
  blue: "蓝色",
  amber: "琥珀",
  green: "绿色",
  violet: "紫色",
};

interface NewEntryForm extends CreateNavigationItem {
  name: string;
  url: string;
  description: string;
  accent: NavigationAccent;
}

const initialForm: NewEntryForm = {
  name: "",
  url: "",
  description: "",
  accent: "blue",
};

interface AddEntryDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onCreated: (item: NavigationItem) => void;
}

export function AddEntryDialog({
  dialogRef,
  onCreated,
}: AddEntryDialogProps): React.JSX.Element {
  const [form, setForm] = useState<NewEntryForm>(initialForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");

    const normalized = normalizeHttpUrl(form.url);
    if (!normalized.ok) {
      setError(normalized.message);
      return;
    }

    setSaving(true);

    try {
      const item = await createNavigation({ ...form, url: normalized.url });
      onCreated(item);
      setForm(initialForm);
      dialogRef.current?.close();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "保存入口失败。",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog className="modal" ref={dialogRef}>
      <div className="modal-box max-w-lg">
        <button
          className="btn btn-circle btn-ghost btn-sm absolute right-4 top-4"
          aria-label="关闭"
          type="button"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={17} />
        </button>

        <div className="mb-7">
          <p className="section-kicker">NEW ENTRY</p>
          <h2 className="mt-2 text-2xl font-semibold">添加工作入口</h2>
          <p className="mt-2 text-sm text-base-content/55">
            支持网页、localhost/内网服务，以及本机文件夹或程序路径。
          </p>
        </div>

        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <label className="fieldset">
            <span className="fieldset-legend">名称</span>
            <input
              className="input w-full"
              maxLength={80}
              required
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="例如：供应链系统"
            />
          </label>

          <label className="fieldset">
            <span className="fieldset-legend">网址或本机路径</span>
            <input
              className="input w-full"
              type="text"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              required
              value={form.url}
              onChange={(event) =>
                setForm((current) => ({ ...current, url: event.target.value }))
              }
              placeholder="localhost:3000、https://… 或 C:\Users\demo"
            />
            <span className="fieldset-label text-base-content/60">
              不带协议自动补全：本机/内网补 http://，域名补 https://；C:\ 开头按本机路径保存
            </span>
          </label>

          <label className="fieldset">
            <span className="fieldset-legend">说明</span>
            <input
              className="input w-full"
              maxLength={200}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="这个入口用来做什么"
            />
          </label>

          <fieldset className="fieldset">
            <legend className="fieldset-legend">识别色</legend>
            <div className="flex flex-wrap gap-2">
              {(
                Object.entries(accentLabels) as [NavigationAccent, string][]
              ).map(([value, label]) => (
                <label className="accent-choice" key={value} data-accent={value}>
                  <input
                    className="radio radio-sm"
                    type="radio"
                    name="accent"
                    value={value}
                    checked={form.accent === value}
                    onChange={() =>
                      setForm((current) => ({ ...current, accent: value }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {error !== "" && (
            <div className="alert alert-error text-sm" role="alert">
              {error}
            </div>
          )}

          <div className="modal-action">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              取消
            </button>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <Plus size={17} />
              )}
              保存入口
            </button>
          </div>
        </form>
      </div>
      <form className="modal-backdrop" method="dialog">
        <button type="submit">关闭</button>
      </form>
    </dialog>
  );
}