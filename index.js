import { runBot as runLinkedInBot } from './scraper/linkedinBot.js';
import { runFacebookBot } from './scraper/facebookGroupsBot.js';

const runAll = async () => {
    console.log('🤖 EJECUTANDO TODOS LOS BOTS');
    console.log('===============================\n');
    
    await runLinkedInBot();
    console.log('\n---\n');
    await runFacebookBot();
};

runAll();