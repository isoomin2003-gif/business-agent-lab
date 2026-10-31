FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY public ./public
COPY server ./server
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/ranking.db
EXPOSE 3000
CMD ["npm", "start"]
