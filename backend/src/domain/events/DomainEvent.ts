export abstract class DomainEvent {
  public readonly occurredAt: Date;
  public readonly aggregateId: string;

  constructor(aggregateId: string) {
    this.occurredAt = new Date();
    this.aggregateId = aggregateId;
  }
}

export class MasteryUpdatedEvent extends DomainEvent {
  constructor(
    public readonly studentId: string,
    public readonly skillId: string,
    public readonly previousLevel: number,
    public readonly newLevel: number,
    public readonly attemptId: string
  ) {
    super(studentId);
  }
}

export class ProgressUpdatedEvent extends DomainEvent {
  constructor(
    public readonly studentId: string,
    public readonly skillId: string,
    public readonly newMastery: number
  ) {
    super(studentId);
  }
}
