import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

const SEARCH_URL = 'https://www.linkedin.com/search/results/content/?keywords=programador&sortBy=DATE_POSTED';
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const runBot = async () => {
  console.log('🚀 Iniciando scraping...');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/snap/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1280,800',
      '--lang=en-US,en',
    ],
  });

  const page = await browser.newPage();
  
  // Ocultar que es puppeteer
  await page.evaluateOnNewDocument(() => {
    delete navigator.__proto__.webdriver;
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);

  // Cargar cookies
  try {
    console.log('🍪 Cargando cookies...');
    const cookiesFile = await fs.readFile('./scraper/cookies.json', 'utf-8');
    const cookies = JSON.parse(cookiesFile);
    await page.setCookie(...cookies);
    console.log('✅ Cookies cargadas');
  } catch (error) {
    console.log('⚠️ No hay cookies:', error.message);
    await browser.close();
    return;
  }

  // Intentar acceder con delays y reintentos
  console.log('🔐 Accediendo a LinkedIn...');
  
  let success = false;
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto('https://www.linkedin.com/feed/', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      await delay(3000 + Math.random() * 2000);
      
      const url = page.url();
      if (!url.includes('login') && !url.includes('auth')) {
        success = true;
        console.log('✅ Sesión activa');
        break;
      }
      console.log(`⚠️ Intento ${i+1}: redirigido a login`);
      await delay(3000);
    } catch (error) {
      console.log(`⚠️ Intento ${i+1} falló: ${error.message}`);
    }
  }

  if (!success) {
    console.log('❌ No se pudo establecer sesión. Cookies expiradas.');
    await browser.close();
    return;
  }

  // Navegar a búsqueda
  console.log('🔍 Buscando posts...');
  
  try {
    await page.goto(SEARCH_URL, { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    await delay(5000);
    console.log('✅ Página de búsqueda cargada');
  } catch (error) {
    console.log('❌ Error:', error.message);
    await browser.close();
    return;
  }

  // Scroll y extracción
  console.log('📊 Extrayendo posts...');
  
  const posts = await page.evaluate(() => {
    const elements = document.querySelectorAll('[data-urn]');
    return Array.from(elements).map(el => ({
      id: el.getAttribute('data-urn'),
      text: el.innerText?.substring(0, 500) || '',
      link: el.querySelector('a')?.href || '',
      author: el.querySelector('.update-components-actor__name')?.innerText || 'Desconocido'
    }));
  });

  console.log(`📦 Total posts: ${posts.length}`);

  if (posts.length === 0) {
    console.log('⚠️ No se encontraron posts');
    await page.screenshot({ path: './scraper/debug.png' });
    console.log('📸 Screenshot guardado');
    await browser.close();
    return;
  }

  const seen = await getSeen();
  const newPosts = posts.filter(p => p.id && !seen.includes(p.id) && KEYWORDS.some(k => p.text.toLowerCase().includes(k)));

  console.log(`🧠 Nuevos posts: ${newPosts.length}`);

  if (newPosts.length > 0) {
    await sendAlert(newPosts);
    const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
    await saveSeen(updatedSeen);
    console.log('✅ Alertas enviadas');
  }

  await browser.close();
  console.log('✨ Proceso completado');
};

runBot().catch(console.error);