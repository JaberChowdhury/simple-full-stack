import { promises as fs } from "fs";
import path from "path";
import { z, ZodSchema } from "zod";

class WriteLock {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve();
      });
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.locked = false;
    }
  }
}

type WithId<T> = T & { id: string };

class QueryBuilder<T> {
  private data: WithId<T>[];

  constructor(data: WithId<T>[]) {
    this.data = [...data];
  }

  filter(predicate: (item: WithId<T>) => boolean): this {
    this.data = this.data.filter(predicate);
    return this;
  }

  limit(n: number): this {
    this.data = this.data.slice(0, n);
    return this;
  }

  sort<K extends keyof WithId<T>>(key: K, order: "asc" | "desc" = "asc"): this {
    this.data.sort((a, b) => {
      const valA = a[key];
      const valB = b[key];
      if (valA < valB) return order === "asc" ? -1 : 1;
      if (valA > valB) return order === "asc" ? 1 : -1;
      return 0;
    });
    return this;
  }

  exec(): WithId<T>[] {
    return this.data;
  }
}

export class JsonFileStore<T> {
  private filePath: string;
  private schema: ZodSchema<T>;
  private lock = new WriteLock();

  constructor(schema: ZodSchema<T>, filename: string, dir: string = "./data") {
    this.schema = schema;
    this.filePath = path.resolve(dir, filename);
    fs.mkdir(dir, { recursive: true }).catch(console.error);
  }

  private async readFile(): Promise<WithId<T>[]> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      return JSON.parse(content || "[]");
    } catch (err: any) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  private async writeFile(data: WithId<T>[]): Promise<void> {
    await this.lock.acquire();
    try {
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } finally {
      this.lock.release();
    }
  }

  async getAll(): Promise<WithId<T>[]> {
    return await this.readFile();
  }

  async getById(id: string): Promise<WithId<T> | null> {
    const data = await this.readFile();
    return data.find((item) => item.id === id) || null;
  }

  async create(input: unknown): Promise<WithId<T>> {
    const parsed = this.schema.parse(input);
    const data = await this.readFile();
    const newItem: WithId<T> = { ...parsed, id: crypto.randomUUID() };
    data.push(newItem);
    await this.writeFile(data);
    return newItem;
  }

  async update(id: string, updates: Partial<T>): Promise<WithId<T> | null> {
    const data = await this.readFile();
    const index = data.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const updated = { ...data[index], ...updates };
    const parsed = this.schema.partial().parse(updated);
    data[index] = { ...data[index], ...parsed };

    await this.writeFile(data);
    return data[index];
  }

  async delete(id: string): Promise<boolean> {
    const data = await this.readFile();
    const newData = data.filter((item) => item.id !== id);
    if (newData.length === data.length) return false;

    await this.writeFile(newData);
    return true;
  }

  async find(filterFn: (item: WithId<T>) => boolean): Promise<WithId<T>[]> {
    const data = await this.readFile();
    return data.filter(filterFn);
  }

  async first(
    filterFn: (item: WithId<T>) => boolean
  ): Promise<WithId<T> | null> {
    const data = await this.readFile();
    return data.find(filterFn) || null;
  }

  async count(filterFn?: (item: WithId<T>) => boolean): Promise<number> {
    const data = await this.readFile();
    return filterFn ? data.filter(filterFn).length : data.length;
  }

  async exists(id: string): Promise<boolean> {
    const data = await this.readFile();
    return data.some((item) => item.id === id);
  }

  async query(): Promise<QueryBuilder<T>> {
    const data = await this.readFile();
    return new QueryBuilder(data);
  }
}
