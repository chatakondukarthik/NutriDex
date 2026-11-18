import { cookies } from "next/headers";
import { defaultPersonId, getPerson, type Person } from "@/lib/db/people";

/**
 * Resolve the person a request acts for.
 *
 * The cookie holds an opaque person id, never a secret. It is a convenience
 * pointer, not a credential: a forged value can only select another person in
 * the same trusted household, and it is validated against the roster before
 * use. Server actions and pages call this; a client-supplied id is never
 * authoritative.
 */

export const PERSON_COOKIE = "np_person";

/** One year; not a session credential, so it may outlive the browser session. */
const PERSON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Pick a valid active person id from a candidate cookie value. Exported
 * separately from `cookies()` so the selection rules can be tested without a
 * request context.
 */
export function resolvePersonId(candidate: string | undefined): string {
  if (candidate) {
    const person = getPerson(candidate);
    if (person && !person.archivedAt) return person.id;
  }
  return defaultPersonId();
}

export async function getActivePerson(): Promise<Person> {
  const store = await cookies();
  const id = resolvePersonId(store.get(PERSON_COOKIE)?.value);
  const person = getPerson(id);
  if (!person) {
    // `resolvePersonId` only returns an existing person; this guards a
    // hand-edited database between the two reads.
    throw new Error("The active person no longer exists.");
  }
  return person;
}

export async function getActivePersonId(): Promise<string> {
  return (await getActivePerson()).id;
}

export async function setActivePersonCookie(personId: string): Promise<void> {
  const person = getPerson(personId);
  if (!person || person.archivedAt) {
    throw new Error("That person is not available.");
  }
  const store = await cookies();
  store.set(PERSON_COOKIE, person.id, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: PERSON_COOKIE_MAX_AGE,
  });
}

/**
 * Forms may carry the person they were rendered for. It is a staleness check,
 * never an instruction: the server has already resolved the active person,
 * and a mismatch refuses the write instead of applying it to the wrong diary.
 */
export function assertExpectedPerson(
  expected: string | null | undefined,
  active: Pick<Person, "id">,
): void {
  if (expected && expected !== active.id) {
    throw new Error("You switched people. Review this form and submit it again.");
  }
}
