FROM node:20-alpine
WORKDIR /workspace

COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/backend ./apps/backend

RUN npm install
RUN npm --workspace @eda/backend run prisma:generate

EXPOSE 5050
CMD ["npm", "--workspace", "@eda/backend", "run", "start:dev"]
