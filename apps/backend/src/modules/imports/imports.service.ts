import { Injectable } from '@nestjs/common';
import { importRunSchema } from '@eda/shared';
import { parseZod } from '../../common/utils/parsers';

@Injectable()
export class ImportsService {
  run(payload: unknown) {
    const data = parseZod(importRunSchema, payload);

    return {
      ok: true,
      message: 'Import pipeline ready. Connect your CRM mapper here.',
      replaceExisting: data.replaceExisting,
      summary: {
        customersUpserted: 0,
        contactsLinked: 0,
        jobsUpserted: 0,
      },
    };
  }
}
