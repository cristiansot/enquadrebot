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
      '--disable-gpu'
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
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

  console.log('🔐 Accediendo a LinkedIn...');
  
  // Primero cargar la página principal
  await page.goto('https://www.linkedin.com/', { 
    waitUntil: 'domcontentloaded',
    timeout: 60000 
  });
  await delay(3000);
  
  console.log('📍 URL actual:', page.url());
  
  // Verificar si estamos logueados
  const isLoggedIn = await page.evaluate(() => {
    return document.querySelector('[data-tracking-control-name="nav-account-menu"]') !== null;
  });
  
  if (!isLoggedIn) {
    console.log('❌ No logueado. Las cookies expiraron.');
    await browser.close();
    return;
  }
  
  console.log('✅ Sesión activa');

  // Navegar a búsqueda
  console.log('🔍 Buscando posts...');
  
  await page.goto(SEARCH_URL, { 
    waitUntil: 'domcontentloaded', 
    timeout: 60000 
  });
  await delay(5000);
  
  console.log('✅ Página de búsqueda cargada');

  // Scroll
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await delay(2000);
  }

  // Extraer posts
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
    await browser.close();
    return;
  }

  const seen = await getSeen();
  const newPosts = posts.filter(p => 
    p.id && 
    !seen.includes(p.id) && 
    KEYWORDS.some(k => p.text.toLowerCase().includes(k))
  );

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