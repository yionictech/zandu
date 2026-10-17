import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createStorage } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import type { Bucket } from '../modules/storage/storage.js';

/**
 * Prépare et vérifie le stockage objet avant le démarrage de l'API (recette, production) :
 *   - crée les deux compartiments s'ils manquent ;
 *   - un objet du compartiment public se lit sans signature (photos des produits) ;
 *   - un objet du compartiment privé ne se lit PAS sans signature (pièces d'identité, preuves).
 * Usage : node dist/cli/check-storage.js — code de sortie 1 si une règle n'est pas respectée.
 */
const config = loadConfig();
if (config.storage.driver !== 's3') {
  console.log('Stockage de développement : rien à vérifier.');
  process.exit(0);
}
const s3 = config.storage;
const client = new S3Client({
  region: s3.region,
  ...(s3.endpoint ? { endpoint: s3.endpoint } : {}),
  forcePathStyle: s3.forcePathStyle,
  credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
});
const storage = createStorage(config);
const problems: string[] = [];

for (const bucket of Object.values(s3.buckets)) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Compartiment ${bucket} créé.`);
  }
}

/** Lecture sans signature, sur l'adresse interne du stockage : la règle d'accès elle-même. */
async function anonymousStatus(bucket: Bucket, key: string): Promise<number> {
  const signed = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: s3.buckets[bucket], Key: key }),
    { expiresIn: 60 },
  );
  const response = await fetch(signed.split('?')[0]!);
  await response.arrayBuffer();
  return response.status;
}

const probe = `verification/${randomUUID()}.txt`;
for (const bucket of ['public', 'private'] as const) {
  await storage.put(bucket, probe, Buffer.from('zandu'), 'text/plain');
  try {
    const status = await anonymousStatus(bucket, probe);
    if (bucket === 'public' && status !== 200)
      problems.push(
        `Le compartiment public ${s3.buckets.public} refuse la lecture sans signature (${status}) : ` +
          "les photos des produits ne s'afficheraient pas.",
      );
    if (bucket === 'private' && status < 400)
      problems.push(
        `DANGER : le compartiment privé ${s3.buckets.private} se lit sans signature (${status}) : ` +
          "les pièces d'identité seraient publiques.",
      );
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: s3.buckets[bucket], Key: probe }));
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`✘ ${problem}`);
  process.exit(1);
}
console.log(
  `Stockage vérifié : ${s3.buckets.public} public en lecture, ${s3.buckets.private} privé.`,
);
