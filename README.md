# seeder

To install dependencies:

```bash
bun install
```
To create new db
```bash
npx prisma migrate dev --name init
npx prisma migrate deploy
 npx prisma generate      
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.0.35. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

# image scraper

it will be called at the end of the script to go through all schools and save their images under "images" folder. If you wish to integrate the functionality to be inside the seeder itself while going through all folders, you can pass the school's name like this for example:

```javascript
await ProcessFolder('ABC College')
```