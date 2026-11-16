import {contentCopy} from './config/copy';
import {loadBook, type ContentItem} from './content';
import {loadPassage as resolvePassage, loadPassages as resolvePassages, type PassageTranslation} from '../shared/domain/catalog';
export {passages, passageTranslations, type PassageTranslation, type PassageMetadata} from '../shared/domain/catalog';
export function loadPassage(id: string, translation: PassageTranslation = 'BSB'): Promise<ContentItem> {return resolvePassage(id, translation, loadBook, {messages:contentCopy})}
export function loadPassages(translation: PassageTranslation = 'BSB'): Promise<ContentItem[]> {return resolvePassages(translation, loadBook, {messages:contentCopy})}
