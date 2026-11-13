import nodemailer from "nodemailer";

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

export async function sendMail(to: string, subject: string, text: string) {
  if (!mailConfigured()) return false;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "1",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || "" } : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM || "Spekup <noreply@spekup.com>",
    to,
    subject,
    text,
  });
  return true;
}
