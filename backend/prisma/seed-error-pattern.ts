import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const prisma = new PrismaClient()

interface MappedMicroSkill {
  microSkillCode: string
  relevance: number
  isPrimary: boolean
}

interface ErrorPatternData {
  code: string
  name: string
  description: string
  category: string
  severity: string
  source?: string
  reviewed?: boolean
  confidence?: number
  mappedMicroSkills: MappedMicroSkill[]
}

interface ErrorPatternJsonData {
  errorPatterns: ErrorPatternData[]
}

async function main() {
  console.log('🌱 Seeding ErrorPattern data...')

  // Load ErrorPattern JSON (authoritative source of truth)
  const jsonPath = path.join(__dirname, 'error-pattern-data.json')
  const jsonData: ErrorPatternJsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

  console.log(`📖 Loaded ${jsonData.errorPatterns.length} ErrorPatterns from error-pattern-data.json`)

  // ---- PRE-CHECK: all referenced MicroSkill codes must exist ----
  const referencedCodes = new Set<string>()
  for (const pattern of jsonData.errorPatterns) {
    for (const mapping of pattern.mappedMicroSkills) {
      referencedCodes.add(mapping.microSkillCode)
    }
  }

  const dbMicroSkills = await prisma.microSkill.findMany({
    where: { code: { in: [...referencedCodes] } },
    select: { id: true, code: true }
  })
  const microSkillIdByCode = new Map(dbMicroSkills.map((ms) => [ms.code, ms.id]))

  const missingCodes = [...referencedCodes].filter((code) => !microSkillIdByCode.has(code))
  if (missingCodes.length > 0) {
    console.error(`❌ Missing MicroSkill codes in database (${missingCodes.length}):`)
    for (const code of missingCodes) console.error(`   - ${code}`)
    throw new Error('Aborting: JSON references MicroSkills that do not exist in the database.')
  }
  console.log(`✅ All ${referencedCodes.size} referenced MicroSkill codes exist in the database`)

  let inserted = 0
  let updated = 0
  let mappingsCreated = 0
  let mappingsUpdated = 0

  // ---- TRANSACTION: only ErrorPattern + ErrorPatternMicroSkill are touched ----
  // The interactive timeout is raised because the import can run over a high-
  // latency connection, where the Prisma default of 5s is too short.
  await prisma.$transaction(async (tx) => {
    for (const pattern of jsonData.errorPatterns) {
      const existing = await tx.errorPattern.findUnique({ where: { code: pattern.code } })

      // Preserve JSON values as-is; only default when the field is absent from JSON.
      const errorPatternData = {
        name: pattern.name,
        description: pattern.description,
        category: pattern.category,
        severity: pattern.severity,
        source: pattern.source ?? 'MENTORA_MANUAL',
        reviewed: pattern.reviewed ?? true,
        confidence: pattern.confidence ?? 0.8
      }

      const errorPattern = await tx.errorPattern.upsert({
        where: { code: pattern.code },
        update: errorPatternData,
        create: {
          code: pattern.code,
          ...errorPatternData,
          isActive: true
        }
      })

      if (existing) {
        updated++
      } else {
        inserted++
      }

      // ---- Mappings: deterministic upsert on the composite key ----
      for (const mapping of pattern.mappedMicroSkills) {
        const microSkillId = microSkillIdByCode.get(mapping.microSkillCode)!

        const existingMapping = await tx.errorPatternMicroSkill.findUnique({
          where: {
            errorPatternId_microSkillId: {
              errorPatternId: errorPattern.id,
              microSkillId
            }
          }
        })

        await tx.errorPatternMicroSkill.upsert({
          where: {
            errorPatternId_microSkillId: {
              errorPatternId: errorPattern.id,
              microSkillId
            }
          },
          update: {
            relevance: mapping.relevance,
            isPrimary: mapping.isPrimary
          },
          create: {
            errorPatternId: errorPattern.id,
            microSkillId,
            relevance: mapping.relevance,
            isPrimary: mapping.isPrimary
          }
        })

        if (existingMapping) {
          mappingsUpdated++
        } else {
          mappingsCreated++
        }
      }
    }
  }, { timeout: 120000, maxWait: 30000 })

  // ---- FINAL COUNTS ----
  const finalErrorPatternCount = await prisma.errorPattern.count()
  const finalMappingCount = await prisma.errorPatternMicroSkill.count()

  console.log('📊 ErrorPattern Seed Summary:')
  console.log(`   ErrorPatterns inserted: ${inserted}`)
  console.log(`   ErrorPatterns updated: ${updated}`)
  console.log(`   ErrorPatternMicroSkill mappings inserted: ${mappingsCreated}`)
  console.log(`   ErrorPatternMicroSkill mappings updated: ${mappingsUpdated}`)
  console.log(`   Final ErrorPattern count: ${finalErrorPatternCount}`)
  console.log(`   Final ErrorPatternMicroSkill count: ${finalMappingCount}`)

  console.log('✅ ErrorPattern seeding completed successfully!')
}

main()
  .catch((e) => {
    console.error('❌ ErrorPattern seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
