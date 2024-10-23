import {promisify} from "util";
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
import prisma from './lib/prisma'
import fs, {readFileSync, statSync} from "fs";
import path, {sep} from "path";
import {convertPDFToImages} from "./lib/PDFToImage.ts";
import {pipeline} from "stream";
import fetch from "node-fetch";

const BATCH_SIZE = 100;
const TEMP_DIR = './temp';
const DONE_DIR = './done';
if(!fs.existsSync(DONE_DIR)) {
    fs.mkdirSync(DONE_DIR);
}
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// Initialize the S3 client for images
const s3Images = new S3Client({
  endpoint: process.env.BB_SPACE_ENDPOINT,
  region: process.env.BB_IMAGE_REGION,
  credentials: {
    accessKeyId: process.env.BB_IMAGE_KEY,
    secretAccessKey: process.env.BB_IMAGE_SECRET,
  },
  forcePathStyle: true,
});

// Initialize the S3 client for documents
const s3Documents = new S3Client({
  endpoint: process.env.BB_SPACE_ENDPOINT,
  region: process.env.BB_DOCUMENT_REGION,
  credentials: {
    accessKeyId: process.env.BB_DOCUMENT_KEY,
    secretAccessKey: process.env.BB_DOCUMENT_SECRET,
  },
  forcePathStyle: true,
});

//upload to BB
export async function uploadFile(filePath: string) {
  // Ensure the file exists and has content
  const fileStats = statSync(filePath);
  if (fileStats.size === 0) {
    throw new Error("File is empty.");
  }
  // Read the file data
  const fileData = readFileSync(filePath);

  if (!fileData || fileData.length === 0) {
    throw new Error("File data is empty or could not be read.");
  }

  try {
    // Read the file data
    const fileData = readFileSync(filePath);

    // Upload the document using the documents S3 client
    const documentUrl = await uploadToBackblaze(
        s3Documents,
        fileData,
        process.env.BB_DOCUMENT_SPACE || 'dev-docs-unotes',
        filePath.split(sep).pop() || "",
        'application/pdf'
    );
    // Generate thumbnail (assuming the function already exists)
    const thumbnailPath = await convertPDFToImages(filePath, true); // Assuming this function is implemented
    const thumbnailData = readFileSync(thumbnailPath.toString());

    // Upload the thumbnail using the images S3 client
    const thumbnailUrl = await uploadToBackblaze(
        s3Images,
        thumbnailData,
        process.env.BB_IMAGE_SPACE || 'dev-unotes-images',
        getDocumentNameWithPng(filePath),
        'image/png'
    );
    return { documentUrl, thumbnailUrl };
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}
function getDocumentNameWithPng(filePath: string) {
  //get name from filePath
  const name = filePath.split(sep).pop() || "";
  return name.replace('.pdf', '.png')
}


async function uploadToBackblaze(s3Client: any, fileData: Buffer, bucket: string, fileName: string, contentType: string): Promise<string> {

  const uploadParams = {
    Bucket: bucket,
    Key: fileName,
    Body: fileData,
    ContentType: contentType,
    ContentLength: fileData.length,
  };

  try {
    const data = await s3Client.send(new PutObjectCommand(uploadParams));
    console.log(`File uploaded successfully: ${data.$metadata.httpStatusCode}`);
    return fileName;
  } catch (error) {
    console.error("Error uploading to Backblaze B2:", error);
    throw error;
  }
}


// download files and prep them


async function loadAllDocumentsFromDB(skip: number, take: number) {
  return prisma.document.findMany({
    skip,
    take,
    select: {
      id: true,
      files: {
        select: {
          url: true,
          id: true,
        },
      },
    },
  });
}

async function downloadFileFromDO(url: string, fileName: string): Promise<string | null> {
  try {
    const doneFilePath = path.join(DONE_DIR, fileName);

    if (fs.existsSync(doneFilePath)) {
      return null;
    }

    const tempFilePath = path.join(TEMP_DIR, fileName);

    if (fs.existsSync(tempFilePath)) {
      return tempFilePath;
    }

    // Download the file from the URL
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download file from ${url}. Status: ${response.statusText}`);
    }

    const writeStream = fs.createWriteStream(tempFilePath);
    const streamPipeline = promisify(pipeline);

    await streamPipeline(response.body, writeStream);

    return tempFilePath;
  } catch (error) {
    console.error('Error downloading file from DigitalOcean:', error);
    throw error;
  }
}


async function processBatch(skip: number, take: number) {
  const documents = await loadAllDocumentsFromDB(skip, take);

  if (!documents.length) {
    console.log('No more documents to process.');
    return false;
  }
  console.log(`Processing batch of ${documents.length} documents...`);
  for (const document of documents) {
      try {
        const fileName = document.files[0].url.split('/').pop(); // Extract file name from URL
        console.log(`Processing file: ${fileName}`);

        if(fileName) {
          // Step 1: Download the file from DigitalOcean
          const downloadedFilePath = await downloadFileFromDO(document.files[0].url, fileName);
          if(downloadedFilePath) {
            // Step 2: Upload the file to BackBlaze
            const { documentUrl, thumbnailUrl } = await uploadFile(downloadedFilePath);
            // Step 3: Update the document record with the new URL
           const doc = await prisma.document.update({
              where: { id: document.id },
              data: {
                files: {
                    update: {
                        where: { id: document.files[0].id },
                        data: {
                        url: documentUrl,
                        },
                    },
                },
                thumbnail: thumbnailUrl,
              },
            });
            console.log(`Document updated: ${doc.id}`);
            console.log(`File processed and updated: ${fileName}`);
            //save file to done
            fs.renameSync(downloadedFilePath, path.join(DONE_DIR, fileName));
            return ;
          }
        }
      } catch (error) {
        console.error(`Error processing file ${document.files[0].url}:`, error);
      }
  }
  return true;
}

async function transferFiles() {
  let skip = 0;
  const take = BATCH_SIZE;

  while (await processBatch(skip, take)) {
    skip += take;
  }

  console.log('All files processed successfully.');
}

// Start the transfer process
await transferFiles().catch(error => {
  console.error('Error during file transfer:', error);
});

console.log("_________________________________________")
console.log("Seeder completed: No more documents to seed")
console.log("Seeder completed")