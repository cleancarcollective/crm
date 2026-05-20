/**
 * Shared <head> block for all transactional / lead emails.
 *
 * Hardens against:
 *  - Dark-mode color inversion (Gmail, iOS Mail, Outlook.com) which would
 *    flip the dark header to a grey background, leaving white text invisible.
 *  - Mobile padding overflow on narrow screens.
 *
 * Three layers of dark-mode defence - each major email client tags
 * dark-mode rendering differently:
 *   1. `<meta name="color-scheme" content="light only">` - modern Gmail
 *      and iOS Mail respect this and skip auto-inversion entirely.
 *   2. `@media (prefers-color-scheme: dark)` - covers clients that
 *      ignore the meta but still expose the user's preference.
 *   3. `[data-ogsc]` selectors - cover Outlook.com which adds that
 *      attribute when user has dark mode on.
 *
 * Inject into the `<head>` of every email template via:
 *   ${EMAIL_HEAD_HARDENING}
 *
 * Then on the header/footer markup, use these class hooks:
 *   email-header           - header <td>
 *   email-header-eyebrow   - small uppercase line above the title
 *   email-header-title     - h1
 *   email-footer           - footer <td>
 *   email-footer-title     - main footer text
 *   email-footer-sub       - secondary footer text (address, link)
 *   email-pad-x            - any cell whose horizontal padding should shrink on mobile
 */

export const EMAIL_HEAD_HARDENING = `
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <style>
      /* Mobile padding tweaks */
      @media only screen and (max-width: 480px) {
        .email-card { width: 100% !important; max-width: 100% !important; }
        .email-pad-x { padding-left: 24px !important; padding-right: 24px !important; }
        .email-header h1 { font-size: 22px !important; }
      }

      /* Dark-mode hardening - re-assert header/footer colors when the
         user's email client tries to invert them. */
      @media (prefers-color-scheme: dark) {
        .email-header,
        .email-footer { background-color: #1a1713 !important; }
        .email-header-eyebrow { color: #c9c5c0 !important; }
        .email-header-title,
        .email-footer-title { color: #ffffff !important; }
        .email-footer-sub { color: #7a6f68 !important; }
      }
      [data-ogsc] .email-header,
      [data-ogsc] .email-footer { background-color: #1a1713 !important; }
      [data-ogsc] .email-header-eyebrow { color: #c9c5c0 !important; }
      [data-ogsc] .email-header-title,
      [data-ogsc] .email-footer-title { color: #ffffff !important; }
      [data-ogsc] .email-footer-sub { color: #7a6f68 !important; }
    </style>
`;
