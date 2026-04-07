import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';
import { execSync } from 'child_process';

const SEARCH_URL = 'https://www.linkedin.com/search/results/content/?keywords=programador&sortBy=DATE_POSTED';
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Detectar entorno
const isEC2 = process.env.IS_EC2 === 'true' || process.env.AWS_EXECUTION_ENV === 'AWS_EC2';
const isMac = process.platform === 'darwin';

// Obtener ruta del navegador
const getBrowserPath = () => {
  if (isEC2) {
    return '/snap/bin/chromium';
  }
  if (isMac) {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return undefined; // Dejar que puppeteer encuentre uno
};

export const runBot = async () => {
  console.log('🚀 Iniciando scraping...');
  console.log(`🖥️ Entorno: ${isEC2 ? 'EC2' : 'Mac'}`);

  const launchOptions = {
    headless: isEC2 ? true : false,  // EC2 siempre headless, Mac visible
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ],
  };

  const browserPath = getBrowserPath();
  if (browserPath) {
    launchOptions.executablePath = browserPath;
    console.log(`🔧 Usando: ${browserPath}`);
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1280, height: 800 });
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);

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
  }

  // Si no hay cookies y estamos en Mac, hacer login manual
  if (!hasCookies && !isEC2) {
    console.log('\n🔐 LOGIN MANUAL REQUERIDO');
    console.log('========================================');
    console.log('1️⃣  Se abrirá Chrome');
    console.log('2️⃣  Inicia sesión en LinkedIn MANUALMENTE');
    console.log('3️⃣  Espera a que cargue tu feed');
    console.log('========================================\n');
    
    await page.goto('https://www.linkedin.com/login', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    console.log('⏳ Esperando 30 segundos para que hagas login...');
    await delay(30000);
    
    const cookies = await page.cookies();
    if (cookies.length > 0) {
      await fs.writeFile('./scraper/cookies.json', JSON.stringify(cookies, null, 2));
      console.log(`✅ ${cookies.length} cookies guardadas`);
      hasCookies = true;
    }
  }

  if (!hasCookies) {
    console.log('❌ No hay cookies válidas');
    await browser.close();
    return;
  }

  console.log('🔐 Accediendo a LinkedIn...');
  
  try {
    await page.goto('https://www.linkedin.com/feed/', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    await delay(3000);
    console.log('✅ Página cargada');
  } catch (error) {
    console.log('❌ Error:', error.message);
    await browser.close();
    return;
  }

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