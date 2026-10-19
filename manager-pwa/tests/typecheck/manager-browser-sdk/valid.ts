import { createClient } from '@supabase/supabase-js';

const client = createClient('https://example.supabase.co', 'public-anon-key');
const uploadBlob = client.storage.from('documents').upload('guide.pdf', new Blob(['guide']));
const updateBytes = client.storage.from('documents').update('guide.pdf', new Uint8Array([1, 2, 3]));

void uploadBlob;
void updateBytes;
