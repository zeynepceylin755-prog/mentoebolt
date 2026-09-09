import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // 1. Create a test user with student profile
  const user = await prisma.user.create({
    data: {
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'Student',
      role: 'STUDENT',
      emailVerified: true,
      studentProfile: {
        create: {
          grade: 11,
          school: 'Test School',
          learningStage: 'discovery',
        },
      },
    },
  })

  console.log(`✅ Created user: ${user.email}`)

  // 2. Create sample questions
  const question1 = await prisma.question.create({
    data: {
      content: 'f(x) = 2x + 3 fonksiyonu için f(2) değeri kaçtır?',
      type: 'CALCULATION',
      difficulty: 1,
      skillId: 'skill-1',
      correctAnswer: '7',
      explanation: 'f(2) = 2(2) + 3 = 4 + 3 = 7',
      isActive: true,
      options: {
        create: [
          { text: '5', isCorrect: false, order: 0 },
          { text: '7', isCorrect: true, order: 1 },
          { text: '9', isCorrect: false, order: 2 },
          { text: '3', isCorrect: false, order: 3 },
        ],
      },
    },
  })

  console.log(`✅ Created question: ${question1.id}`)

  const question2 = await prisma.question.create({
    data: {
      content: 'Aşağıdakilerden hangisi bir fonksiyon değildir?',
      type: 'MULTIPLE_CHOICE',
      difficulty: 2,
      skillId: 'skill-1',
      correctAnswer: '0',
      explanation: 'Fonksiyon tanımı: her x değeri için yalnızca bir y değeri olmalıdır.',
      isActive: true,
      options: {
        create: [
          { text: 'x = y²', isCorrect: true, order: 0 },
          { text: 'y = x²', isCorrect: false, order: 1 },
          { text: 'y = 2x', isCorrect: false, order: 2 },
          { text: 'y = sin(x)', isCorrect: false, order: 3 },
        ],
      },
    },
  })

  console.log(`✅ Created question: ${question2.id}`)

  console.log('🌱 Seeding complete!')
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
