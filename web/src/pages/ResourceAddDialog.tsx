import { Plus, X } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useState,
} from "react";

import type {
  CreateResourceInput,
  ResourceItem,
} from "../../shared/contracts/resources";
import { createResource } from "../api";

export function AddResourceDialog({
  dialogRef,
  onCreated,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  onCreated: () => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<"note" | "link">("note");
  const [title, setTitle] = useState("");
  const [values, setValues] = useState({ note: "", link: "" });
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const value = values[kind];

  function setValue(nextValue: string): void {
    setValues((current) => ({ ...current, [kind]: nextValue }));
  }

  function selectKind(nextKind: "note" | "link"): void {
    setKind(nextKind);
  }

  function handleKindTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
  ): void {
    let nextKind: "note" | "link";
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      nextKind = kind === "note" ? "link" : "note";
    } else if (event.key === "Home") {
      nextKind = "note";
    } else if (event.key === "End") {
      nextKind = "link";
    } else {
      return;
    }

    event.preventDefault();
    selectKind(nextKind);
    requestAnimationFrame(() =>
      document.getElementById(`resource-tab-${nextKind}`)?.focus(),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");

    const common = {
      title,
      tags: tags
        .split(/[,，\n]/u)
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    const input: CreateResourceInput =
      kind === "note"
        ? { ...common, kind: "note", content: value }
        : { ...common, kind: "link", url: value };

    try {
      await createResource(input);
      setTitle("");
      setValues({ note: "", link: "" });
      setTags("");
      dialogRef.current?.close();
      onCreated();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "资料保存失败。",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      className="modal resource-dialog"
      ref={dialogRef}
      aria-labelledby="resource-dialog-title"
      aria-describedby="resource-dialog-description"
    >
      <div className="modal-box max-w-lg resource-dialog-box">
        <button
          className="btn btn-circle btn-ghost btn-sm absolute right-4 top-4"
          type="button"
          aria-label="关闭"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={17} />
        </button>
        <div className="resource-dialog-head">
          <p className="section-kicker">NEW RESOURCE</p>
          <h2
            className="mt-2 text-2xl font-semibold"
            id="resource-dialog-title"
          >
            添加资料
          </h2>
          <p id="resource-dialog-description">
            保存文字笔记或网页链接，资料只保存在本机。
          </p>
        </div>

        <div
          className="tabs tabs-box mt-6 resource-dialog-tabs"
          role="tablist"
          aria-label="资料类型"
        >
          <button
            className={`tab ${kind === "note" ? "tab-active" : ""}`}
            id="resource-tab-note"
            type="button"
            role="tab"
            aria-selected={kind === "note"}
            aria-controls="resource-dialog-panel"
            tabIndex={kind === "note" ? 0 : -1}
            onClick={() => selectKind("note")}
            onKeyDown={handleKindTabKeyDown}
          >
            文字笔记
          </button>
          <button
            className={`tab ${kind === "link" ? "tab-active" : ""}`}
            id="resource-tab-link"
            type="button"
            role="tab"
            aria-selected={kind === "link"}
            aria-controls="resource-dialog-panel"
            tabIndex={kind === "link" ? 0 : -1}
            onClick={() => selectKind("link")}
            onKeyDown={handleKindTabKeyDown}
          >
            网页链接
          </button>
        </div>

        <form
          className="mt-5 space-y-5 resource-dialog-form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div
            className="resource-dialog-panel space-y-5"
            id="resource-dialog-panel"
            role="tabpanel"
            aria-labelledby={
              kind === "note" ? "resource-tab-note" : "resource-tab-link"
            }
          >
            <label className="fieldset">
              <span className="fieldset-legend">标题</span>
              <input
                className="input w-full"
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="fieldset">
              <span className="fieldset-legend">
                {kind === "note" ? "内容" : "网址"}
              </span>
              {kind === "note" ? (
                <textarea
                  className="textarea min-h-32 w-full"
                  required
                  maxLength={10_000}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              ) : (
                <input
                  className="input w-full"
                  type="url"
                  required
                  placeholder="https://"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              )}
            </label>
            <label className="fieldset">
              <span className="fieldset-legend">标签</span>
              <input
                className="input w-full"
                maxLength={300}
                placeholder="采购，生产，参考"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
            </label>
          </div>

          {error !== "" && (
            <div className="alert alert-error text-sm" role="alert">
              {error}
            </div>
          )}

          <div className="modal-action resource-dialog-footer">
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
                <Plus size={16} />
              )}
              保存资料
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
