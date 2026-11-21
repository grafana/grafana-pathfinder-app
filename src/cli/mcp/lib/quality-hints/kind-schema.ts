import { z } from 'zod';

export const KindSchema = z
  .enum(['reference', 'teach', 'walkthrough'])
  .optional()
  .describe(
    'OPTIONAL. The kind of guide this is (`guideShape.kinds`). Declared once at pathfinder_create_package; here it applies only to stateless mode.'
  );
