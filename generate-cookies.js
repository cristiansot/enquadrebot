import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import readline from 'readline';

const waitForUserInput = (question) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

console.log('🍪 Generador de cookies para LinkedIn');
const browser = await puppeteer.launch({ headless: false });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

console.log('\n📌 Inicia sesión en LinkedIn MANUALMENTE y luego presiona ENTER');
await waitForUserInput('✅ Presiona ENTER después de haber iniciado sesión: ');

const cookies = await page.cookies();
await fs.mkdir('./scraper', { recursive: true });
await fs.writeFile('./scraper/cookies.json', JSON.stringify(cookies, null, 2));
console.log(`✅ ${cookies.length} cookies guardadas`);

await browser.close();