import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Active-person resolution (D-051, security invariants 1–3).
 *
 * The cookie is a convenience pointer, never a credential. It holds an opaque
 * person id, is validated against the roster on every read, and falls back to
 * the default person when the id is unknown, archived or absent. A forged
 * value can only select someone in the same trusted household; it can never
 * become an instruction the server acts on.
 *
 * `assertExpectedPerson` is the second half: a form rendered for one person
 * must not silently write to another after a switch.
 */

const store = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  options: new Map<string, Record<string, unknown>>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      store.jar.has(name)
        ? { name, value: store.jar.get(name)! }
        : undefined,
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      store.jar.set(name, value);
      store.options.set(name, options ?? {});
    },
  }),
}));

let dir: string;
let db: typeof import("@/lib/db/client")["db"];
let people: typeof import("@/lib/db/people");
let server: typeof import("@/lib/person-server");
let a: string;
let b: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-person-server-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  vi.stubEnv("NUTRIPLAN_DATA_DIR", dir);

  db = (await import("@/lib/db/client")).db;
  people = await import("@/lib/db/people");
  server = await import("@/lib/person-server");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  store.jar.clear();
  store.options.clear();

  db.exec(`
    DELETE FROM plan_entries;
    DELETE FROM plans;
    DELETE FROM entries;
    DELETE FROM food_default_amounts;
    DELETE FROM person_settings;
    DELETE FROM profile;
    DELETE FROM people;
  `);
  people.ensureHousehold();
  a = people.defaultPersonId();
  b = people.createPerson({ displayName: "Priya" }).id;
});

describe("resolvePersonId", () => {
  it("uses an active person named by the cookie", () => {
    expect(server.resolvePersonId(b)).toBe(b);
    expect(server.resolvePersonId(a)).toBe(a);
  });

  it("falls back to the default for an absent cookie", () => {
    expect(server.resolvePersonId(undefined)).toBe(a);
  });

  it("falls back to the default for a forged or deleted id", () => {
    expect(server.resolvePersonId("not-a-person")).toBe(a);
    expect(server.resolvePersonId("local")).toBe(a);
  });

  it("never resolves an archived person", () => {
    people.archivePerson(b);
    expect(server.resolvePersonId(b)).toBe(a);
  });

  it("skips an archived default when another person is active", () => {
    people.archivePerson(a);
    expect(server.resolvePersonId(undefined)).toBe(b);
  });
});

describe("getActivePerson", () => {
  it("reads the cookie when it names an active person", async () => {
    store.jar.set(server.PERSON_COOKIE, b);
    await expect(server.getActivePerson()).resolves.toMatchObject({
      id: b,
      displayName: "Priya",
    });
    await expect(server.getActivePersonId()).resolves.toBe(b);
  });

  it("falls back to the default when the cookie is stale", async () => {
    store.jar.set(server.PERSON_COOKIE, "deleted-person");
    await expect(server.getActivePerson()).resolves.toMatchObject({ id: a });
  });

  it("ignores a stale cookie after that person is archived", async () => {
    store.jar.set(server.PERSON_COOKIE, b);
    people.archivePerson(b);
    await expect(server.getActivePersonId()).resolves.toBe(a);
  });
});

describe("setActivePersonCookie", () => {
  it("stores only the person id, in a readable cookie with a long life", async () => {
    await server.setActivePersonCookie(b);

    expect(store.jar.get(server.PERSON_COOKIE)).toBe(b);
    expect(store.options.get(server.PERSON_COOKIE)).toEqual({
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 365,
    });
  });

  it("refuses an archived or unknown person", async () => {
    people.archivePerson(b);

    await expect(server.setActivePersonCookie(b)).rejects.toThrow(/not available/i);
    await expect(server.setActivePersonCookie("not-a-person")).rejects.toThrow(
      /not available/i,
    );
    expect(store.jar.has(server.PERSON_COOKIE)).toBe(false);
  });
});

describe("assertExpectedPerson", () => {
  it("allows a form that names no person", () => {
    expect(() => server.assertExpectedPerson(undefined, { id: a })).not.toThrow();
    expect(() => server.assertExpectedPerson(null, { id: a })).not.toThrow();
  });

  it("allows the person the form was rendered for", () => {
    expect(() => server.assertExpectedPerson(a, { id: a })).not.toThrow();
  });

  it("refuses a write after the active person changed", () => {
    expect(() => server.assertExpectedPerson(b, { id: a })).toThrow(
      /switched people/i,
    );
  });
});
