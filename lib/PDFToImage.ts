import path from 'path';
import pdfConverter from 'pdf-poppler';
import {readdir, unlink} from 'fs/promises';

async function convertPDFToImages(pdfFilePath: string, isThumbnail?:boolean): Promise<string[] | string> {
    try {
        let opts = {
            format: 'png',
            out_dir: path.dirname(pdfFilePath),
            out_prefix: path.basename(pdfFilePath, path.extname(pdfFilePath)),
            page: isThumbnail ? 1 : null,
        };
        await pdfConverter.convert(pdfFilePath, opts);

        const files = await readdir(opts.out_dir);
        const outputFiles = files.filter(file =>
            file.startsWith(opts.out_prefix) && path.extname(file).toLowerCase() !== '.pdf'
        );
        if(isThumbnail) return path.join(opts.out_dir, outputFiles[0]);
        return outputFiles.map(file => path.join(opts.out_dir, file));
    } catch (error) {
        console.error(`Error converting PDF to images: ${error}`);
        return [];
    }
}

async function deleteImages(imagePaths: string[]) {
    for (const imagePath of imagePaths) {
        try {
            await unlink(imagePath);
        } catch (error) {
            console.error(`Error deleting image ${imagePath}: ${error}`);
        }
    }
}


export { convertPDFToImages, deleteImages };
