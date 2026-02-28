import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:4200';
  const appOrigin = process.env.APP_ORIGIN ?? deriveOrigin(appBaseUrl);
  app.enableCors({
    origin: appOrigin,
    credentials: true,
  });

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: false,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 5050);
  await app.listen(port);
}

bootstrap();

function deriveOrigin(urlLike: string) {
  try {
    return new URL(urlLike).origin;
  } catch {
    return urlLike;
  }
}
