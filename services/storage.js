import fs from 'fs-extra';
import fs from 'fs/promises';

const getSeenFile = (source = 'linkedin') => `./data/seen_${source}.json`;

export const getSeen = async (source = 'linkedin') => {
    try {
        const file = await fs.readFile(getSeenFile(source), 'utf-8');
        return JSON.parse(file);
    } catch (error) {
        return [];
    }
};

export const saveSeen = async (seen, source = 'linkedin') => {
    await fs.mkdir('./data', { recursive: true });
    await fs.writeFile(getSeenFile(source), JSON.stringify(seen, null, 2));
};