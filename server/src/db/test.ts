import { z } from "zod";
import { JsonFileStore } from "./Controller";

const TodoSchema = z.object({
  title: z.string(),
  done: z.boolean().default(false),
  createdAt: z.string().default(() => new Date().toISOString()),
});

const store = new JsonFileStore(TodoSchema, "todos.json", "./data");

async function demo() {
  await store.create({ title: "Task A", done: false });
  await store.create({ title: "Task B", done: true });
  await store.create({ title: "Task C", done: false });

  const activeTodos = await store.find((todo) => !todo.done);
  console.log("Active Todos:", activeTodos);

  const firstDone = await store.first((todo) => todo.done);
  console.log("First Done:", firstDone);

  const limitedSorted = await (
    await store.query()
  )
    .filter((t) => !t.done)
    .sort("createdAt", "desc")
    .limit(2)
    .exec();

  console.log("Limited + Sorted:", limitedSorted);
}

demo();
