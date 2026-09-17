import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const prisma = new PrismaClient()

interface CurriculumData {
  source: {
    name: string
    grade: number
    subject: string
    sourceFiles: string[]
    updateDate: string
  }
  themes: ThemeData[]
}

interface ThemeData {
  code: string
  name: string
  lessonHours: number
  sourceFile?: string
  learningOutcomes: LearningOutcomeData[]
}

interface LearningOutcomeData {
  code: string
  officialText: string
  processComponents: ProcessComponentData[]
}

interface ProcessComponentData {
  code: string
  officialText: string
}

async function main() {
  console.log('🌱 Importing MEB Curriculum Data...')

  // Load canonical JSON
  const jsonPath = path.join(__dirname, '../data/curriculum/mentora_11_math_curriculum.json')
  const jsonData: CurriculumData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

  console.log(`📖 Loaded curriculum data from: ${jsonData.source.name}`)
  console.log(`📚 Grade: ${jsonData.source.grade}, Subject: ${jsonData.source.subject}`)
  console.log(`📋 Themes: ${jsonData.themes.length}`)

  // Check for existing curriculum data
  const existingVersions = await prisma.curriculumVersion.count()
  if (existingVersions > 0) {
    console.log(`⚠️  Found ${existingVersions} existing curriculum version(s)`)
    console.log('⚠️  Import will be idempotent - only import if not exists')
  }

  // Use transaction for atomic import
  await prisma.$transaction(async (tx) => {
    // Create or get CurriculumVersion
    const curriculumVersionCode = `MEB-${jsonData.source.grade}-${jsonData.source.subject}-${jsonData.source.updateDate}`
    
    const existingVersion = await tx.curriculumVersion.findUnique({
      where: { code: curriculumVersionCode }
    })

    let curriculumVersionId: string

    if (existingVersion) {
      console.log(`✅ Curriculum version already exists: ${curriculumVersionCode}`)
      curriculumVersionId = existingVersion.id
    } else {
      const curriculumVersion = await tx.curriculumVersion.create({
        data: {
          code: curriculumVersionCode,
          name: jsonData.source.name,
          grade: jsonData.source.grade,
          subject: jsonData.source.subject,
          version: jsonData.source.updateDate,
          source: jsonData.source.name,
          sourceDocument: jsonData.source.sourceFiles.join(', '),
          updateDate: jsonData.source.updateDate ? new Date(jsonData.source.updateDate) : null,
          isActive: true
        }
      })
      curriculumVersionId = curriculumVersion.id
      console.log(`✅ Created curriculum version: ${curriculumVersionCode}`)
    }

    // Import themes
    let totalThemes = 0
    let totalOutcomes = 0
    let totalComponents = 0

    for (const themeData of jsonData.themes) {
      // Check if theme already exists
      const existingTheme = await tx.theme.findFirst({
        where: {
          curriculumVersionId,
          officialCode: themeData.code
        }
      })

      let themeId: string

      if (existingTheme) {
        console.log(`✅ Theme already exists: ${themeData.code} - ${themeData.name}`)
        themeId = existingTheme.id
      } else {
        const theme = await tx.theme.create({
          data: {
            curriculumVersionId,
            officialCode: themeData.code,
            name: themeData.name,
            lessonHours: themeData.lessonHours,
            sourceOrder: parseInt(themeData.code),
            sourceDocument: themeData.sourceFile || jsonData.source.sourceFiles[0],
            sourceTheme: themeData.code
          }
        })
        themeId = theme.id
        console.log(`✅ Created theme: ${themeData.code} - ${themeData.name}`)
        totalThemes++
      }

      // Import learning outcomes
      for (const loData of themeData.learningOutcomes) {
        // Check if learning outcome already exists
        const existingOutcome = await tx.learningOutcome.findFirst({
          where: {
            themeId,
            officialCode: loData.code
          }
        })

        let learningOutcomeId: string

        if (existingOutcome) {
          console.log(`✅ Learning outcome already exists: ${loData.code}`)
          learningOutcomeId = existingOutcome.id
        } else {
          const learningOutcome = await tx.learningOutcome.create({
            data: {
              themeId,
              officialCode: loData.code,
              officialText: loData.officialText,
              sourceOrder: parseInt(loData.code.slice(-2)) || 0
            }
          })
          learningOutcomeId = learningOutcome.id
          console.log(`✅ Created learning outcome: ${loData.code}`)
          totalOutcomes++
        }

        // Import process components
        for (const pcData of loData.processComponents) {
          // Check if process component already exists
          const existingComponent = await tx.processComponent.findFirst({
            where: {
              learningOutcomeId,
              officialCode: pcData.code
            }
          })

          if (existingComponent) {
            console.log(`✅ Process component already exists: ${pcData.code}`)
          } else {
            await tx.processComponent.create({
              data: {
                learningOutcomeId,
                officialCode: pcData.code,
                officialText: pcData.officialText,
                sourceOrder: pcData.code.charCodeAt(0) // Use char code for simple ordering
              }
            })
            console.log(`✅ Created process component: ${pcData.code}`)
            totalComponents++
          }
        }
      }
    }

    console.log('📊 Import Summary:')
    console.log(`   Themes created: ${totalThemes}`)
    console.log(`   Learning outcomes created: ${totalOutcomes}`)
    console.log(`   Process components created: ${totalComponents}`)
  })

  // Validation after import
  const finalVersions = await prisma.curriculumVersion.count()
  const finalThemes = await prisma.theme.count()
  const finalOutcomes = await prisma.learningOutcome.count()
  const finalComponents = await prisma.processComponent.count()

  console.log('🔍 Final Database State:')
  console.log(`   CurriculumVersions: ${finalVersions}`)
  console.log(`   Themes: ${finalThemes}`)
  console.log(`   LearningOutcomes: ${finalOutcomes}`)
  console.log(`   ProcessComponents: ${finalComponents}`)

  // Validate expected counts
  const expectedThemes = 3
  const expectedOutcomes = 9
  const expectedComponents = 60

  if (finalThemes !== expectedThemes) {
    throw new Error(`Theme count mismatch: expected ${expectedThemes}, got ${finalThemes}`)
  }
  if (finalOutcomes !== expectedOutcomes) {
    throw new Error(`Learning outcome count mismatch: expected ${expectedOutcomes}, got ${finalOutcomes}`)
  }
  if (finalComponents !== expectedComponents) {
    throw new Error(`Process component count mismatch: expected ${expectedComponents}, got ${finalComponents}`)
  }

  console.log('✅ Curriculum import completed successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Curriculum import failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })