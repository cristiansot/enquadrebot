import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import readline from 'readline';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';
import { execSync } from 'child_process';

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

// Función para obtener la ruta de Chromium en EC2
const getChromiumPath = () => {
  try {
    // Intentar diferentes rutas posibles
    const paths = [
      '/snap/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/lib/chromium-browser/chromium-browser'
    ];
    
    for (const path of paths) {
      try {
        execSync(`test -f ${path}`, { stdio: 'ignore' });
        return path;
      } catch (e) {
        // Continuar con la siguiente ruta
      }
    }
    
    // Si no encuentra, intentar con which
    const whichPath = execSync('which chromium-browser || which chromium', { stdio: 'pipe' }).toString().trim();
    if (whichPath) return whichPath;
    
    throw new Error('Chromium no encontrado');
  } catch (error) {
    console.log('⚠️ Chromium no encontrado, instalando...');
    try {
      execSync('sudo snap install chromium', { stdio: 'inherit' });
      return '/snap/bin/chromium';
    } catch (installError) {
      console.error('❌ No se pudo instalar Chromium automáticamente');
      throw installError;
    }
  }
};

export const runBot = async () => {
  console.log('🚀 Iniciando scraping...');
  console.log('🌐 Abriendo navegador...');

  // Detectar si estamos en EC2
  const isEC2 = process.env.IS_EC2 === 'true';
  const isHeadless = process.env.HEADLESS === 'true' || isEC2; // EC2 siempre headless

  // Configuración de Puppeteer
  const launchOptions = {
    headless: isHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',  // Importante para EC2
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check'
    ],
  };

  // Configurar executablePath según el entorno
  if (isEC2) {
    launchOptions.executablePath = getChromiumPath();
    console.log(`🖥️ EC2 detectado - Usando Chromium en: ${launchOptions.executablePath}`);
  } else if (!isHeadless) {
    launchOptions.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  
  // Configurar viewport y timeout
  await page.setViewport({ width: 1280, height: 800 });
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  // Configurar User-Agent para evitar detección
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

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
    
    if (isEC2) {
      console.log('\n❌ ERROR: EC2 requiere cookies pre-generadas');
      console.log('Por favor, genera cookies en tu Mac local y súbelas a EC2:');
      console.log('1. En tu Mac: HEADLESS=false node scraper/linkedinBot.js');
      console.log('2. Haz login manual');
      console.log('3. Sube scraper/cookies.json a EC2');
      console.log('\nEjecución cancelada');
      await browser.close();
      return;
    }
  }

  console.log('🔐 Navegando a LinkedIn...');
  
  try {
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
    console.log('🔄 Reintentando...');
    await page.goto('https://www.linkedin.com', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
  }

  // Login manual solo si no hay cookies y no estamos en EC2
  if (!hasCookies && !isEC2) {
    console.log('\n========================================');
    console.log('🔐 LOGIN MANUAL REQUERIDO');
    console.log('========================================');
    console.log('📌 INSTRUCCIONES:');
    console.log('1️⃣  La ventana del navegador está abierta');
    console.log('2️⃣  Ve a la pestaña de LinkedIn');
    console.log('3️⃣  Si ves la página de login, inicia sesión MANUALMENTE');
    console.log('4️⃣  Espera a que cargue COMPLETAMENTE tu feed');
    console.log('========================================\n');
    
    await waitForUserInput('✅ Presiona ENTER cuando hayas completado el login correctamente: ');
    
    console.log('\n💾 Guardando cookies para futuros accesos...');
    await delay(3000);
    
    const cookies = await page.cookies();
    if (cookies.length === 0) {
      console.log('⚠️ No se encontraron cookies');
      const continuar = await waitForUserInput('¿Intentar continuar? (s/n): ');
      if (continuar.toLowerCase() !== 's') {
        await browser.close();
        return;
      }
    } else {
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
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  }

  // Esperar un poco para que cargue el contenido dinámico
  await delay(5000);

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
      console.log('💡 Necesitas generar nuevas cookies desde tu Mac y subirlas a EC2');
      await browser.close();
      return;
    }
    
    console.log('📸 Tomando screenshot para diagnóstico...');
    await page.screenshot({ path: './scraper/debug-screenshot.png' });
    console.log('💾 Screenshot guardado como debug-screenshot.png');
    
    // Intentar con un selector alternativo
    try {
      await page.waitForSelector('[data-urn]', { timeout: 10000 });
      console.log('✅ Encontrados posts con selector alternativo');
    } catch (e) {
      console.log('❌ No se encontraron posts con ningún selector');
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
    
    if (elements.length === 0) {
      // Intentar con selectores alternativos
      const altElements = document.querySelectorAll('[data-urn]');
      return Array.from(altElements).map(el => ({
        id: el.getAttribute('data-urn'),
        text: el.innerText?.substring(0, 500) || '',
        link: el.querySelector('a')?.href,
        author: el.querySelector('[data-anonymize="actor-name"]')?.innerText || 'Desconocido'
      }));
    }

    return Array.from(elements).map(el => ({
      id: el.getAttribute('data-urn'),
      text: el.innerText?.substring(0, 500) || '',
      link: el.querySelector('a')?.href,
      author: el.querySelector('.update-components-actor__name')?.innerText || 'Desconocido'
    }));
  });

  console.log(`📦 Total posts obtenidos: ${posts.length}`);

  if (posts.length === 0) {
    console.log('⚠️ No se encontraron posts.');
    if (!isEC2) {
      console.log('💡 Sugerencia: Ejecuta con HEADLESS=false para depurar visualmente');
    }
    await waitForUserInput('Presiona ENTER para continuar...');
    await browser.close();
    return;
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
    
    newPosts.forEach((post, index) => {
      console.log(`\n📝 Post ${index + 1}:`);
      console.log(`   ID: ${post.id}`);
      console.log(`   Autor: ${post.author}`);
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
  
  if (!isEC2) {
    const closeBrowser = await waitForUserInput('¿Cerrar el navegador? (s/n): ');
    if (closeBrowser.toLowerCase() === 's') {
      console.log('🛑 Cerrando navegador...');
      await browser.close();
    }
  } else {
    console.log('🛑 Cerrando navegador...');
    await browser.close();
  }
};

// Scroll humano mejorado
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      let scrollCount = 0;
      const maxScrolls = 8;

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

// Ejecutar solo si no es importado
if (import.meta.url === `file://${process.argv[1]}`) {
  runBot().catch(async (error) => {
    console.error('❌ Error en el bot:', error);
    process.exit(1);
  });
}