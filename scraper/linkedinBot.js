import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import readline from 'readline';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

const SEARCH_URL = 'https://www.linkedin.com/search/results/content/?keywords=programador&sortBy=DATE_POSTED';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función para esperar entrada del usuario
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

export const runBot = async () => {
  console.log('🚀 Iniciando scraping...');
  console.log('🌐 Abriendo navegador...');

  const isHeadless = process.env.HEADLESS === 'true';

  const browser = await puppeteer.launch({
    headless: isHeadless,
    executablePath: isHeadless
      ? undefined
      : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security'
    ],
  });

  const page = await browser.newPage();
  
  // Configurar viewport
  await page.setViewport({ width: 1280, height: 800 });

  let hasCookies = false;

  // 🍪 Cargar cookies si existen
  try {
    console.log('🍪 Intentando cargar cookies...');
    const cookiesFile = await fs.readFile('./scraper/cookies.json', 'utf-8');
    const cookies = JSON.parse(cookiesFile);
    await page.setCookie(...cookies);
    hasCookies = true;
    console.log('✅ Cookies cargadas');
  } catch (error) {
    console.log('⚠️ No hay cookies guardadas o archivo inválido');
  }

  console.log('🔐 Abriendo LinkedIn...');
  await page.goto('https://www.linkedin.com/login', { 
    waitUntil: 'networkidle2',
    timeout: 30000 
  });

  // 🔥 LOGIN MANUAL SOLO SI NO HAY COOKIES
  if (!hasCookies) {
    console.log('\n========================================');
    console.log('🔐 LOGIN MANUAL REQUERIDO');
    console.log('========================================');
    console.log('1️⃣  La ventana del navegador está abierta');
    console.log('2️⃣  Por favor, inicia sesión en LinkedIn MANUALMENTE');
    console.log('3️⃣  Espera a que cargue tu feed principal');
    console.log('========================================\n');
    
    // Esperar a que el usuario presione ENTER - esto mantiene el proceso vivo
    await waitForUserInput('✅ Presiona ENTER cuando hayas completado el login correctamente: ');
    
    console.log('\n💾 Guardando cookies para futuros accesos...');
    
    // Pequeña pausa para asegurar que las cookies están disponibles
    await delay(2000);
    
    const cookies = await page.cookies();
    if (cookies.length === 0) {
      console.log('⚠️ No se encontraron cookies. Asegúrate de haber iniciado sesión correctamente');
    } else {
      await fs.writeFile('./scraper/cookies.json', JSON.stringify(cookies, null, 2));
      console.log(`✅ ${cookies.length} cookies guardadas correctamente`);
    }
  }

  console.log('\n🔍 Navegando a la búsqueda de posts...');
  await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  try {
    await page.waitForSelector('.feed-shared-update-v2', { timeout: 15000 });
    console.log('✅ Posts encontrados en el DOM');
  } catch (error) {
    console.log('❌ No se encontraron posts. Verificando si hay sesión activa...');
    
    // Verificar si estamos en la página de login
    const currentUrl = page.url();
    if (currentUrl.includes('login')) {
      console.log('⚠️ La sesión expiró. Por favor, ejecuta el script nuevamente');
      await waitForUserInput('Presiona ENTER para cerrar el navegador...');
      await browser.close();
      return;
    }
  }

  console.log('🖱️ Haciendo scroll para cargar más posts...');
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

  console.log('\n========================================');
  console.log('✨ PROCESO COMPLETADO ✨');
  console.log('========================================');
  
  // Preguntar si quiere cerrar el navegador
  const closeBrowser = await waitForUserInput('¿Cerrar el navegador? (s/n): ');
  
  if (closeBrowser.toLowerCase() === 's') {
    console.log('🛑 Cerrando navegador...');
    await browser.close();
  } else {
    console.log('👨‍💻 Navegador mantenido abierto. Puedes cerrarlo manualmente cuando quieras');
    // Mantener el proceso vivo pero no hacer nada más
    await new Promise(() => {});
  }
};

// 🔽 Scroll humano mejorado
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const scrollAttempts = 0;
      const maxScrolls = 10; // Límite de scrolls para no cargar infinitamente

      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight || scrollAttempts >= maxScrolls) {
          clearInterval(timer);
          resolve();
        }
      }, 800 + Math.random() * 1000);
    });
  });
}

// ▶️ Ejecutar con manejo de errores
runBot().catch(async (error) => {
  console.error('❌ Error en el bot:', error);
  console.log('Presiona ENTER para salir...');
  await waitForUserInput('');
  process.exit(1);
});