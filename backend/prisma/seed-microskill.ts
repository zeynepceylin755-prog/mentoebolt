import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const prisma = new PrismaClient()

interface MicroSkillData {
  processComponentCode: string
  processComponentText: string
  code: string
  name: string
  description: string
  category: string
  difficulty: string
}

// Parse the full process component code (e.g., "MAT.11.1.1-a") to extract learning outcome code and component letter
function parseProcessComponentCode(fullCode: string): { learningOutcomeCode: string; componentLetter: string } | null {
  const match = fullCode.match(/^(MAT\.11\.\d+\.\d+)-([a-zA-Zçğı])$/)
  if (!match) return null
  return {
    learningOutcomeCode: match[1],
    componentLetter: match[2]
  }
}

interface MicroSkillJsonData {
  microSkills: MicroSkillData[]
}

async function main() {
  console.log('🌱 Seeding MicroSkill data...')

  // Load MicroSkill JSON
  const jsonPath = path.join(__dirname, '../microskill-data.json')
  const jsonData: MicroSkillJsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

  console.log(`📖 Loaded ${jsonData.microSkills.length} MicroSkills from microskill-data.json`)

  let inserted = 0
  let updated = 0

  // Use transaction for atomic import
  await prisma.$transaction(async (tx) => {
    for (const microSkillData of jsonData.microSkills) {
      // Parse the process component code to find the matching ProcessComponent
      const parsed = parseProcessComponentCode(microSkillData.processComponentCode)
      if (!parsed) {
        console.warn(`⚠️  Invalid process component code format: ${microSkillData.processComponentCode}, skipping MicroSkill: ${microSkillData.code}`)
        continue
      }

      // Find the LearningOutcome first
      const learningOutcome = await tx.learningOutcome.findFirst({
        where: {
          officialCode: parsed.learningOutcomeCode
        }
      })

      if (!learningOutcome) {
        console.warn(`⚠️  LearningOutcome not found: ${parsed.learningOutcomeCode}, skipping MicroSkill: ${microSkillData.code}`)
        continue
      }

      // Find the ProcessComponent by learning outcome and component letter
      const processComponent = await tx.processComponent.findFirst({
        where: {
          learningOutcomeId: learningOutcome.id,
          officialCode: parsed.componentLetter
        }
      })

      if (!processComponent) {
        console.warn(`⚠️  ProcessComponent not found: ${parsed.learningOutcomeCode}-${parsed.componentLetter}, skipping MicroSkill: ${microSkillData.code}`)
        continue
      }

      // Check if MicroSkill already exists
      const existingMicroSkill = await tx.microSkill.findUnique({
        where: { code: microSkillData.code }
      })

      if (existingMicroSkill) {
        // Update existing MicroSkill
        await tx.microSkill.update({
          where: { code: microSkillData.code },
          data: {
            processComponentId: processComponent.id,
            name: microSkillData.name,
            description: microSkillData.description,
            category: microSkillData.category,
            difficulty: microSkillData.difficulty,
            source: 'MEB-11-MATH-CURRICULUM',
            updatedAt: new Date()
          }
        })
        console.log(`✅ Updated MicroSkill: ${microSkillData.code}`)
        updated++
      } else {
        // Create new MicroSkill
        await tx.microSkill.create({
          data: {
            processComponentId: processComponent.id,
            code: microSkillData.code,
            name: microSkillData.name,
            description: microSkillData.description,
            category: microSkillData.category,
            difficulty: microSkillData.difficulty,
            source: 'MEB-11-MATH-CURRICULUM',
            confidence: 0.8,
            reviewed: false,
            isActive: true
          }
        })
        console.log(`✅ Created MicroSkill: ${microSkillData.code}`)
        inserted++
      }
    }
  })

  // Final count
  const finalCount = await prisma.microSkill.count()

  console.log('📊 MicroSkill Seed Summary:')
  console.log(`   Inserted: ${inserted}`)
  console.log(`   Updated: ${updated}`)
  console.log(`   Final MicroSkill count: ${finalCount}`)

  console.log('✅ MicroSkill seeding completed successfully!')
}

main()
  .catch((e) => {
    console.error('❌ MicroSkill seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
