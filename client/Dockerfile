# Build Stage
FROM node:20-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production Server Stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html

# Overwrite default nginx config to support React routing fallback if needed
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
