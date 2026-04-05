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

  // Configuración para Mac ARM64
  const launchOptions = {
    headless: isHeadless,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ],
  };

  // Si no es headless, usar Chrome del sistema
  if (!isHeadless) {
    launchOptions.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  
  // Configurar viewport y timeout
  await page.setViewport({ width: 1280, height: 800 });
  page.setDefaultTimeout(60000); // Aumentar timeout global a 60 segundos
  page.setDefaultNavigationTimeout(60000);

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
    console.log('⚠️ No hay cookies guardadas - se requerirá login manual');
  }

  console.log('🔐 Navegando a LinkedIn...');
  
  try {
    // Intentar ir directamente a la página principal si hay cookies
    if (hasCookies) {
      await page.goto('https://www.linkedin.com/feed/', { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      });
    } else {
      await page.goto('https://www.linkedin.com/login', { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      });
    }
    console.log('✅ Página cargada correctamente');
  } catch (error) {
    console.log('❌ Error cargando la página:', error.message);
    console.log('🔄 Reintentando con configuración más permisiva...');
    
    // Reintentar con opciones más flexibles
    await page.goto('https://www.linkedin.com', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
  }

  // 🔥 LOGIN MANUAL SOLO SI NO HAY COOKIES
  if (!hasCookies) {
    console.log('\n========================================');
    console.log('🔐 LOGIN MANUAL REQUERIDO');
    console.log('========================================');
    console.log('📌 INSTRUCCIONES:');
    console.log('1️⃣  La ventana del navegador está abierta');
    console.log('2️⃣  Ve a la pestaña de LinkedIn');
    console.log('3️⃣  Si ves la página de login, inicia sesión MANUALMENTE');
    console.log('4️⃣  Espera a que cargue COMPLETAMENTE tu feed');
    console.log('========================================\n');
    
    // Esperar a que el usuario presione ENTER
    await waitForUserInput('✅ Presiona ENTER cuando hayas completado el login correctamente: ');
    
    console.log('\n💾 Guardando cookies para futuros accesos...');
    
    // Pequeña pausa para asegurar que las cookies están disponibles
    await delay(3000);
    
    const cookies = await page.cookies();
    if (cookies.length === 0) {
      console.log('⚠️ No se encontraron cookies. Asegúrate de haber iniciado sesión correctamente');
      const continuar = await waitForUserInput('¿Intentar continuar de todas formas? (s/n): ');
      if (continuar.toLowerCase() !== 's') {
        await browser.close();
        return;
      }
    } else {
      // Asegurar que el directorio existe
      await fs.mkdir('./scraper', { recursive: true });
      await fs.writeFile('./scraper/cookies.json', JSON.stringify(cookies, null, 2));
      console.log(`✅ ${cookies.length} cookies guardadas correctamente`);
    }
  }

  console.log('\n🔍 Navegando a la búsqueda de posts...');
  
  try {
    await page.goto(SEARCH_URL, { 
      waitUntil: 'networkidle2', 
      timeout: 60000 
    });
    console.log('✅ Página de búsqueda cargada');
  } catch (error) {
    console.log('⚠️ Error cargando búsqueda:', error.message);
    console.log('🔄 Intentando recargar...');
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  }

  // Esperar a que carguen los posts
  try {
    console.log('⏳ Esperando que carguen los posts...');
    await page.waitForSelector('.feed-shared-update-v2', { timeout: 30000 });
    console.log('✅ Posts encontrados en el DOM');
  } catch (error) {
    console.log('❌ No se encontraron posts. Verificando estado de la página...');
    
    const currentUrl = page.url();
    console.log(`📍 URL actual: ${currentUrl}`);
    
    if (currentUrl.includes('login') || currentUrl.includes('auth')) {
      console.log('⚠️ La sesión expiró o no se completó el login correctamente');
      await waitForUserInput('Presiona ENTER para cerrar el navegador y reintentar...');
      await browser.close();
      return;
    }
    
    console.log('📸 Tomando screenshot para diagnóstico...');
    await page.screenshot({ path: './scraper/debug-screenshot.png' });
    console.log('💾 Screenshot guardado como debug-screenshot.png');
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
      text: el.innerText.substring(0, 500), // Limitar texto para no saturar
      link: el.querySelector('a')?.href,
      author: el.querySelector('.update-components-actor__name')?.innerText
    }));
  });

  console.log(`📦 Total posts obtenidos: ${posts.length}`);

  if (posts.length === 0) {
    console.log('⚠️ No se encontraron posts. Puede ser necesario ajustar los selectores.');
    console.log('💡 Sugerencia: Ejecuta con HEADLESS=false para depurar visualmente');
    await waitForUserInput('Presiona ENTER para continuar...');
  }

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
    
    // Mostrar resumen de nuevos posts
    newPosts.forEach((post, index) => {
      console.log(`\n📝 Post ${index + 1}:`);
      console.log(`   Autor: ${post.author || 'Desconocido'}`);
      console.log(`   Preview: ${post.text.substring(0, 100)}...`);
    });
    
    await sendAlert(newPosts);

    const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
    await saveSeen(updatedSeen);

    console.log('💾 Posts guardados como vistos');
  } else {
    console.log('😴 No se encontraron posts nuevos con las keywords especificadas');
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
    // Mantener el proceso vivo
    await new Promise(() => {});
  }
};

// 🔽 Scroll humano mejorado
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      let scrollCount = 0;
      const maxScrolls = 8; // Límite de scrolls

      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        scrollCount++;

        if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
          clearInterval(timer);
          resolve();
        }
      }, 1000);
    });
  });
}

// ▶️ Ejecutar con manejo de errores
runBot().catch(async (error) => {
  console.error('❌ Error en el bot:', error);
  console.log('\n🔧 POSIBLES SOLUCIONES:');
  console.log('1. Verifica tu conexión a internet');
  console.log('2. Asegúrate que LinkedIn está accesible');
  console.log('3. Si el problema persiste, ejecuta: npm install puppeteer@latest');
  console.log('4. Para el problema de arquitectura, reinstala Node.js versión ARM64');
  console.log('\nPresiona ENTER para salir...');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  await new Promise((resolve) => {
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
  
  process.exit(1);
});