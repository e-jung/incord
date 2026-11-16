import {loadBook, type ContentItem, type Translation} from './content';
import {contentCopy} from './config/copy';
import {loadTopic as resolveTopic} from '../shared/domain/catalog';
export {topics,type TopicMetadata} from '../shared/topics';

/** Browser IO edge; topic resolution and membership belong to the shared catalog. */
export function loadTopic(id: string, translation: Translation = 'BSB'): Promise<ContentItem[]> {
 return resolveTopic(id, translation, loadBook, {messages: contentCopy});
}
