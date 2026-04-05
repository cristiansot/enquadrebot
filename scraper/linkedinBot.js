import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

const SEARCH_URL = 'https://www.linkedin.com/search/results/content/?keywords=programador&sortBy=DATE_POSTED';

// 🔧 helper delay compatible con puppeteer v24+
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const runBot = async () => {
  console.log('🚀 Iniciando scraping...');
  console.log('🌐 Abriendo navegador...');

  const browser = await puppeteer.launch({
    headless: false, // 🔥 cambia a false SOLO para login manual
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // 🔑 Cargar cookies si existen
  let hasCookies = false;

  try {
    console.log('🍪 Intentando cargar cookies...');
    const cookies = JSON.parse(await fs.readFile('./scraper/cookies.json'));
    await page.setCookie(...cookies);
    hasCookies = true;
    console.log('✅ Cookies cargadas');
  } catch {
    console.log('⚠️ No hay cookies guardadas');
  }

  console.log('🔐 Abriendo LinkedIn...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });

  await delay(3000);

  // ⚠️ Solo guardar cookies si no existen (evita sobreescribir)
  if (!hasCookies) {
    console.log('💾 Guardando cookies (primer login)...');
    const cookies = await page.cookies();
    await fs.writeFile('./scraper/cookies.json', JSON.stringify(cookies, null, 2));
  }

  console.log('🔍 Buscando posts en LinkedIn...');
  await page.goto(SEARCH_URL, { waitUntil: 'networkidle2' });

  try {
    await page.waitForSelector('.feed-shared-update-v2', { timeout: 10000 });
    console.log('✅ Posts encontrados en el DOM');
  } catch {
    console.log('❌ No se encontraron posts (posible falta de login)');
  }

  // 👇 Scroll humano
  console.log('🖱️ Haciendo scroll...');
  await autoScroll(page);

  const waitTime = 2000 + Math.random() * 2000;
  console.log(`⏱️ Esperando ${Math.round(waitTime)} ms...`);
  await delay(waitTime);

  console.log('📊 Extrayendo posts...');
  const posts = await page.evaluate(() => {
    const elements = document.querySelectorAll('.feed-shared-update-v2');

    return Array.from(elements).map(el => ({
      id: el.getAttribute('data-urn'),
      text: el.innerText,
      link: el.querySelector('a')?.href,
      author: el.querySelector('.update-components-actor__name')?.innerText
    }));
  });

  console.log(`📦 Total posts obtenidos: ${posts.length}`);

  const seen = await getSeen();
  console.log(`👀 Posts ya vistos: ${seen.length}`);

  const newPosts = posts.filter(p =>
    p.id &&
    !seen.includes(p.id) &&
    KEYWORDS.some(k => p.text.toLowerCase().includes(k))
  );

  console.log(`🧠 Posts filtrados por keywords: ${newPosts.length}`);

  if (newPosts.length > 0) {
    console.log(`🔥 ${newPosts.length} nuevos encontrados`);
    await sendAlert(newPosts);

    const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
    await saveSeen(updatedSeen);

    console.log('💾 Posts guardados como vistos');
  } else {
    console.log('😴 Nada nuevo');
  }

  console.log('🛑 Cerrando navegador...');
  await browser.close();
};


// 🔽 Scroll humano
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

// 👇 Ejecutar automáticamente
runBot();