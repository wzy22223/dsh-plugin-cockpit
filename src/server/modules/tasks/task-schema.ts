import { z } from "zod";

const datePattern = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function isCalendarDate(value: string): boolean {
  if (!datePattern.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

const title = z
  .string()
  .trim()
  .min(1, "请输入日程标题。")
  .max(120, "日程标题不能超过 120 个字符。");

const scheduledDate = z
  .string()
  .refine(isCalendarDate, "请输入有效日期，格式为 YYYY-MM-DD。");

const scheduledTime = z
  .string()
  .regex(timePattern, "请输入有效时间，格式为 HH:mm。");

const status = z.enum(["todo", "completed"], {
  error: "状态只能是 todo 或 completed。",
});

export const listTasksQuerySchema = z
  .object({
    date: scheduledDate.optional(),
    from: scheduledDate.optional(),
    to: scheduledDate.optional(),
    status: z
      .enum(["todo", "completed", "all"], {
        error: "筛选状态只能是 todo、completed 或 all。",
      })
      .default("all"),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.date !== undefined && (query.from !== undefined || query.to !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["date"],
        message: "date 不能与 from 或 to 同时使用。",
      });
    }

    if (
      query.from !== undefined &&
      query.to !== undefined &&
      query.from > query.to
    ) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "起始日期不能晚于结束日期。",
      });
    }
  });

export const createTaskSchema = z
  .object({
    title,
    scheduledDate,
    scheduledTime,
  })
  .strict();

export const updateTaskStatusSchema = z
  .object({
    status,
  })
  .strict();
