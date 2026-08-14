import { X } from "lucide-react";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useState,
} from "react";

import type {
  CreateScheduledTask,
  ScheduledTask,
} from "../../shared/contracts/tasks";
import { createScheduledTask } from "../api";

export function AddScheduleDialog({
  dialogRef,
  defaultDate,
  session,
  onCreated,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  defaultDate: string;
  session: number;
  onCreated: (task: ScheduledTask) => void;
}): React.JSX.Element {
  const [form, setForm] = useState<CreateScheduledTask>({
    title: "",
    scheduledDate: defaultDate,
    scheduledTime: "09:00",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm({
      title: "",
      scheduledDate: defaultDate,
      scheduledTime: "09:00",
    });
    setError("");
  }, [defaultDate, session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const task = await createScheduledTask(form);
      onCreated(task);
      setForm((current) => ({
        ...current,
        title: "",
        scheduledTime: "09:00",
      }));
      dialogRef.current?.close();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "日程保存失败。",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      className="schedule-workspace-dialog modal"
      ref={dialogRef}
      aria-labelledby="schedule-workspace-dialog-title"
      aria-describedby="schedule-workspace-dialog-description"
      onClose={() => setError("")}
    >
      <div className="schedule-workspace-dialog-surface modal-box max-w-md">
        <button
          className="schedule-workspace-dialog-close btn btn-circle btn-ghost btn-sm absolute right-4 top-4"
          type="button"
          aria-label="关闭新增日程窗口"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={17} />
        </button>

        <p className="section-kicker">NEW SCHEDULE</p>
        <h2
          className="schedule-workspace-dialog-title mt-2 text-2xl font-semibold"
          id="schedule-workspace-dialog-title"
        >
          添加日程
        </h2>
        <p
          className="schedule-workspace-dialog-description"
          id="schedule-workspace-dialog-description"
        >
          填写内容、日期与时间，保存后会出现在对应视图中。
        </p>

        <form
          className="schedule-workspace-form mt-6 space-y-5"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label className="fieldset">
            <span className="fieldset-legend">日程内容</span>
            <input
              className="input w-full"
              type="text"
              required
              maxLength={120}
              autoFocus
              placeholder="例如：确认生产订单"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="fieldset">
              <span className="fieldset-legend">日期</span>
              <input
                className="input w-full"
                type="date"
                required
                value={form.scheduledDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scheduledDate: event.target.value,
                  }))
                }
              />
            </label>

            <label className="fieldset">
              <span className="fieldset-legend">时间</span>
              <input
                className="input w-full"
                type="time"
                required
                value={form.scheduledTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scheduledTime: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          {error && (
            <p className="schedule-workspace-dialog-error text-sm text-error" role="alert">
              {error}
            </p>
          )}

          <div className="modal-action">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              取消
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={saving}
            >
              {saving ? "保存中…" : "保存日程"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
