// 🧠 Shared username-derivation logic — used by BOTH the email/password
// sign-up form (Login.jsx) and the Google sign-in post-login fixer (App.jsx),
// so both flows stay consistent instead of drifting into two different rules.

export const deriveUsernameFromEmail = (email) => {
  const prefix = email.split('@')[0] || 'student';
  const usernameBase = prefix.toLowerCase().replace(/[^a-z0-9]/g, '') || 'student';
  const uniqueSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${usernameBase}${uniqueSuffix}`;
};