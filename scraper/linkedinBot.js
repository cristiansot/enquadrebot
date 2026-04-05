import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

const SEARCH_URL = 'https://www.linkedin.com/search/results/content/?keywords=programador&sortBy=DATE_POSTED';

export const runBot = async () => {
  console.log('🚀 Iniciando bot...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // 🔑 Cargar cookies si existen
  try {
    const cookies = JSON.parse(await fs.readFile('./scraper/cookies.json'));
    await page.setCookie(...cookies);
    console.log('🍪 Cookies cargadas');
  } catch {
    console.log('⚠️ No hay cookies guardadas');
  }

  await page.goto('https://www.linkedin.com/login');
  await page.waitForTimeout(3000);

  // ⚠️ PRIMERA VEZ: logéate manualmente y luego guarda cookies
  const cookies = await page.cookies();
  await fs.writeFile('./scraper/cookies.json', JSON.stringify(cookies, null, 2));

  await page.goto(SEARCH_URL, { waitUntil: 'networkidle2' });

  await page.waitForSelector('.feed-shared-update-v2');

  // 👇 Scroll humano
  await autoScroll(page);

  // 👇 Delay humano (MUY IMPORTANTE)
  await page.waitForTimeout(2000 + Math.random() * 2000);

  const posts = await page.evaluate(() => {
    const elements = document.querySelectorAll('.feed-shared-update-v2');

    return Array.from(elements).map(el => ({
      id: el.getAttribute('data-urn'),
      text: el.innerText,
      link: el.querySelector('a')?.href,
      author: el.querySelector('.update-components-actor__name')?.innerText
    }));
  });

  const seen = await getSeen();

  const newPosts = posts.filter(p =>
    p.id &&
    !seen.includes(p.id) &&
    KEYWORDS.some(k => p.text.toLowerCase().includes(k))
  );

  if (newPosts.length > 0) {
    console.log(`🔥 ${newPosts.length} nuevos encontrados`);
    await sendAlert(newPosts);

    const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
    await saveSeen(updatedSeen);
  } else {
    console.log('😴 Nada nuevo');
  }

  await browser.close();
};


// 🔽 Función scroll
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;

      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 800 + Math.random() * 1000);
    });
  });
}