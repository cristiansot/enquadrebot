import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

export const sendAlert = async (matches) => {
  const html = matches.map(m => `
    <p><strong>${m.author}</strong></p>
    <p>${m.text.slice(0, 200)}...</p>
    <a href="${m.link}">Ver publicación</a>
    <hr/>
  `).join('');

  await transporter.sendMail({
    from: '"LinkedIn Bot" <bot@alertas.com>',
    to: process.env.EMAIL_USER,
    subject: '🚨 Nuevos leads detectados',
    html
  });
};