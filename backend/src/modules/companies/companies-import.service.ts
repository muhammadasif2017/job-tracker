import { BadRequestException, Injectable } from '@nestjs/common';
import { BusinessMode, CompanyCity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface CsvImportError {
  row: number;
  message: string;
}

export interface CsvImportResult {
  imported: number;
  errors: CsvImportError[];
}

const EXPECTED_HEADER = ['name', 'city', 'businessmode'];

// Hand-rolled, deliberately minimal — no quoted-field/embedded-comma
// support. See docs/specs/target-companies.md Assumption 5: escalate to
// csv-parse only if a real-world export needs that, rather than building it
// preemptively for a fixed 3-column import.
@Injectable()
export class CompaniesImportService {
  constructor(private prisma: PrismaService) {}

  async import(userId: string, content: string): Promise<CsvImportResult> {
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    if (
      header.length !== EXPECTED_HEADER.length ||
      !EXPECTED_HEADER.every((h, i) => header[i] === h)
    ) {
      throw new BadRequestException(
        `Invalid CSV header — expected "name,city,businessMode", got "${lines[0]}"`,
      );
    }

    const dataLines = lines.slice(1);
    if (dataLines.length === 0) {
      throw new BadRequestException('CSV file has no data rows');
    }

    const existing = await this.prisma.company.findMany({
      where: { userId },
      select: { name: true },
    });
    const seenNames = new Set(existing.map((c) => c.name.toLowerCase()));

    const errors: CsvImportError[] = [];
    const toCreate: {
      userId: string;
      name: string;
      city: CompanyCity;
      businessMode?: BusinessMode;
    }[] = [];

    dataLines.forEach((line, idx) => {
      const rowNum = idx + 2; // +1 for header, +1 for 1-indexing
      const fields = line.split(',').map((f) => f.trim());
      if (fields.length !== 3) {
        errors.push({
          row: rowNum,
          message: `Expected 3 columns (name,city,businessMode), got ${fields.length}`,
        });
        return;
      }
      const [name, cityRaw, businessModeRaw] = fields;

      if (!name) {
        errors.push({ row: rowNum, message: 'name is required' });
        return;
      }

      const city = cityRaw.toUpperCase() as CompanyCity;
      if (!Object.values(CompanyCity).includes(city)) {
        errors.push({
          row: rowNum,
          message: `Invalid city "${cityRaw}" — expected one of ${Object.values(CompanyCity).join(', ')}`,
        });
        return;
      }

      let businessMode: BusinessMode | undefined;
      if (businessModeRaw) {
        const candidate = businessModeRaw.toUpperCase() as BusinessMode;
        if (!Object.values(BusinessMode).includes(candidate)) {
          errors.push({
            row: rowNum,
            message: `Invalid businessMode "${businessModeRaw}" — expected one of ${Object.values(BusinessMode).join(', ')}`,
          });
          return;
        }
        businessMode = candidate;
      }

      if (seenNames.has(name.toLowerCase())) {
        errors.push({
          row: rowNum,
          message: `Duplicate company name "${name}" (already saved or repeated earlier in this file)`,
        });
        return;
      }
      seenNames.add(name.toLowerCase());

      toCreate.push({ userId, name, city, businessMode });
    });

    let imported = 0;
    if (toCreate.length > 0) {
      const result = await this.prisma.company.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      imported = result.count;
    }

    return { imported, errors };
  }
}
