/**
 * Pure helpers for the License activation screen and
 * the LicenseCard. Re-exports the `statusLine` and
 * `humanizeInvalidReason` helpers from LicenseCard so
 * both screens can use them without duplicating logic.
 *
 * Why a separate module (vs. importing from
 * LicenseCard.tsx):
 *   - LicenseCard is a React component (has JSX).
 *     Importing the helpers from a `.tsx` is fine
 *     in TS (Vite handles it), but keeps a tighter
 *     module boundary — the helpers are not coupled
 *     to the LicenseCard's component code.
 *   - The helpers are tested in `LicenseCard.test.ts`
 *     (which is the only test file that imports
 *     React-internal helpers in the same place). A
 *     dedicated test for the License screen's
 *     `statusLineForScreen` lives in
 *     `License.test.ts` (see Decision #78 — pure
 *     logic gets unit-tested, the component itself
 *     gets a smoke test).
 */
export { statusLine, humanizeInvalidReason } from '@/screens/SettingsProvider/components/LicenseCard';
