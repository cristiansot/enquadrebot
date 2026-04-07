import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

const SEARCH_URL = 'https://www.linkedin.com/search/results/content/?keywords=programador&sortBy=DATE_POSTED';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const runBot = async () => {
  console.log('🚀 Iniciando scraping en EC2...');
  
  // Configuración mejorada para EC2
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/snap/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1280,800'
    ],
  });

  const page = await browser.newPage();
  
  await page.setViewport({ width: 1280, height: 800 });
  
  // Timeouts más largos (120 segundos)
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(120000);
  
  // User-Agent realista
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Cargar cookies
  let hasCookies = false;
  try {
    console.log('🍪 Cargando cookies...');
    const cookiesFile = await fs.readFile('./scraper/cookies.json', 'utf-8');
    const cookies = JSON.parse(cookiesFile);
    await page.setCookie(...cookies);
    hasCookies = true;
    console.log('✅ Cookies cargadas');
  } catch (error) {
    console.log('⚠️ No hay cookies:', error.message);
    await browser.close();
    return;
  }

  // Navegar a LinkedIn con reintentos
  console.log('🔐 Accediendo a LinkedIn...');
  
  let connected = false;
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto('https://www.linkedin.com/feed/', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      await delay(5000);
      connected = true;
      console.log('✅ Conectado a LinkedIn');
      break;
    } catch (error) {
      console.log(`⚠️ Intento ${i + 1} falló: ${error.message}`);
      await delay(3000);
    }
  }
  
  if (!connected) {
    console.log('❌ No se pudo conectar a LinkedIn');
    await browser.close();
    return;
  }

  // Verificar si estamos logueados
  const currentUrl = page.url();
  if (currentUrl.includes('login') || currentUrl.includes('auth')) {
    console.log('❌ Sesión expirada. Necesitas generar nuevas cookies');
    await browser.close();
    return;
  }
  
  console.log('✅ Sesión activa - URL:', currentUrl);

  // Navegar a búsqueda
  console.log('🔍 Buscando posts...');
  
  try {
    await page.goto(SEARCH_URL, { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    await delay(8000);
    console.log('✅ Página de búsqueda cargada');
  } catch (error) {
    console.log('❌ Error en búsqueda:', error.message);
    await browser.close();
    return;
  }

  // Buscar posts
  let postsFound = false;
  for (let i = 0; i < 5; i++) {
    console.log(`⏳ Buscando posts... intento ${i + 1}/5`);
    
    await page.evaluate(() => window.scrollBy(0, 300));
    await delay(2000);
    
    const hasPosts = await page.evaluate(() => {
      return document.querySelectorAll('[data-urn], .feed-shared-update-v2').length > 0;
    });
    
    if (hasPosts) {
      postsFound = true;
      console.log('✅ Posts encontrados');
      break;
    }
  }

  if (!postsFound) {
    console.log('⚠️ No se encontraron posts');
    await page.screenshot({ path: './scraper/debug.png' });
    console.log('📸 Screenshot guardado');
    await browser.close();
    return;
  }

  // Scroll para cargar más
  console.log('🖱️ Scroll para cargar más...');
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await delay(2000);
  }

  // Extraer posts
  console.log('📊 Extrayendo datos...');
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
    console.log('⚠️ No se extrajeron posts');
    await browser.close();
    return;
  }

  // Filtrar
  const seen = await getSeen();
  console.log(`👀 Vistos: ${seen.length}`);

  const newPosts = posts.filter(p =>
    p.id &&
    !seen.includes(p.id) &&
    KEYWORDS.some(k => p.text.toLowerCase().includes(k))
  );

  console.log(`🧠 Nuevos posts: ${newPosts.length}`);

  if (newPosts.length > 0) {
    console.log(`📧 Enviando ${newPosts.length} alertas...`);
    await sendAlert(newPosts);
    const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
    await saveSeen(updatedSeen);
    console.log('✅ Alertas enviadas');
  } else {
    console.log('😴 No hay posts nuevos');
  }

  console.log('✨ Proceso completado');
  await browser.close();
};

runBot().catch(console.error);