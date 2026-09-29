import type { Context } from '../context';
import { statementExportModel } from '../export/statement-model';
import { renderStatementPdf } from '../export/statement-pdf';
import { renderStatementXlsx } from '../export/statement-xlsx';
export async function exportStatement(ctx: Context, id: string, format: 'xlsx' | 'pdf') {
  const model = await statementExportModel(ctx, id);
  const bytes = format === 'xlsx' ? await renderStatementXlsx(model) : await renderStatementPdf(model);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type':
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
      'content-disposition': `attachment; filename="${model.document_no}.${format}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
