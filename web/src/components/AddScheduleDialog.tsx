import { Plus, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type {
  CreateScheduledTask,
  ScheduledTask,
} from "../../shared/contracts/tasks";
import { createScheduledTask } from "../api";

interface AddScheduleDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  defaultDate: string;
  onCreated: (task: ScheduledTask) => void;
}

export function AddScheduleDialog({
  dialogRef,
  defaultDate,
  onCreated,
}: AddScheduleDialogProps): React.JSX.Element {
  const [form, setForm] = useState<CreateScheduledTask>({
    title: "",
    scheduledDate: defaultDate,
    scheduledTime: "09:00",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm((current) => ({ ...current, scheduledDate: defaultDate }));
  }, [defaultDate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setSaving(true);

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
        caughtError instanceof Error ? caughtError.message : "保存日程失败。",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog className="modal" ref={dialogRef}>
      <div className="modal-box max-w-md">
        <button
          className="btn btn-circle btn-ghost btn-sm absolute right-4 top-4"
          aria-label="关闭"
          type="button"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={17} />
        </button>

        <div className="mb-7">
          <p className="section-kicker">NEW SCHEDULE</p>
          <h2 className="mt-2 text-2xl font-semibold">添加日程</h2>
        </div>

        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <label className="fieldset">
            <span className="fieldset-legend">日程内容</span>
            <input
              className="input w-full"
              maxLength={120}
              required
              autoFocus
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="例如：确认生产订单"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              保存日程
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