/*
 *                            *** MIT LICENSE ***
 * -------------------------------------------------------------------------
 * This code may be modified and distributed under the MIT license.
 * See the LICENSE file for details.
 * -------------------------------------------------------------------------
 *
 * @summary   Helpers for handling gatsby's nodes
 *
 * @author    Alvis HT Tang <alvis@hilbert.space>
 * @license   MIT
 * @copyright Copyright (c) 2021 - All Rights Reserved.
 * -------------------------------------------------------------------------
 */

import { name } from '#.';

import type { NodeInput, NodePluginArgs } from 'gatsby';

import type { FullDatabase, FullPage } from '#types';

interface ContentNode<Type extends string> extends NodeInput {
  ref: string;
  createdTime: string;
  lastEditedTime: string;
  title: string;
  internal: {
    type: Type;
  } & NodeInput['internal'];
}

interface Link {
  object: string;
  id: string;
}

type FullEntity = FullDatabase | FullPage;
type NormalisedEntity<E extends FullEntity = FullEntity> = E extends any
  ? Omit<E, 'parent'> & {
      parent: Link | null;
      children: Link[];
    }
  : never;

/** manage nodes based on data returned from Notion API */
export class NodeManager {
  private createNode: NodePluginArgs['actions']['createNode'];
  private deleteNode: NodePluginArgs['actions']['deleteNode'];
  private createNodeId: NodePluginArgs['createNodeId'];
  private createContentDigest: NodePluginArgs['createContentDigest'];
  private cache: NodePluginArgs['cache'];
  private reporter: NodePluginArgs['reporter'];

  /**
   * create a node manager using arguments from the sourceNodes API
   * @param args arguments passed from the sourceNodes API
   */
  constructor(args: NodePluginArgs) {
    /* eslint-disable @typescript-eslint/unbound-method */
    const {
      actions: { createNode, deleteNode },
      cache,
      createContentDigest,
      createNodeId,
      reporter,
    } = args;
    /* eslint-enable */

    this.cache = cache;
    this.createNode = createNode;
    this.deleteNode = deleteNode;
    this.createNodeId = createNodeId;
    this.createContentDigest = createContentDigest;
    this.reporter = reporter;
  }

  /**
   * update nodes available on gatsby
   * @param entities all entities collected from notion, including database and page
   */
  public async update(entities: FullEntity[]): Promise<void> {
    // get entries with relationship build-in
    const oldMap = new Map<string, NormalisedEntity>(
      (await this.cache.get('entityMap')) ?? [],
    );
    const newMap = computeEntityMap(entities);

    // for the usage of createNode
    // see https://www.gatsbyjs.com/docs/reference/config-files/actions/#createNode
    this.addNodes(this.findNewEntities(oldMap, newMap));
    this.updateNodes(this.findUpdatedEntities(oldMap, newMap));
    this.removeNodes(this.findRemovedEntities(oldMap, newMap));

    await this.cache.set('entityMap', [...newMap.entries()]);
  }

  /**
   * add new nodes
   * @param added new nodes to be added
   */
  private addNodes(added: NormalisedEntity[]): void {
    for (const entity of added) {
      this.createNode(this.nodifyEntity(entity));
    }

    this.reporter.info(`[${name}] added ${added.length} nodes`);
  }

  /**
   * update existing nodes
   * @param updated updated nodes
   */
  private updateNodes(updated: NormalisedEntity[]): void {
    for (const entity of updated) {
      this.createNode(this.nodifyEntity(entity));
    }

    this.reporter.info(`[${name}] updated ${updated.length} nodes`);
  }

  /**
   * remove old nodes
   * @param removed nodes to be removed
   */
  private removeNodes(removed: NormalisedEntity[]): void {
    for (const entity of removed) {
      this.deleteNode(this.nodifyEntity(entity));
    }

    this.reporter.info(`[${name}] removed ${removed.length} nodes`);
  }

  /**
   * create a database node
   * @param database a full database object
   * @returns a database node
   */
  private createDatabaseNode(
    database: NormalisedEntity<FullDatabase>,
  ): ContentNode<'NotionDatabase'> {
    return this.createBaseNode(database, { type: 'NotionDatabase' });
  }

  /**
   * create a page node
   * @param page a full page object
   * @returns a page node
   */
  private createPageNode(
    page: NormalisedEntity<FullPage>,
  ): ContentNode<'NotionPage'> {
    return this.createBaseNode(page, {
      type: 'NotionPage',
      content: page.markdown,
      mediaType: 'text/markdown',
    });
  }

  /**
   * create a node based on common field from an entity
   * @param entity a database or page
   * @param internal extra fields to be merged with in the internal field
   * @returns a node with common data
   */
  private createBaseNode<T extends string>(
    entity: NormalisedEntity,
    internal: Omit<NodeInput['internal'], 'contentDigest'> & { type: T },
  ): ContentNode<T> {
    return {
      id: this.createNodeId(`${entity.object}:${entity.id}`),
      ref: entity.id,
      createdTime: entity.created_time,
      lastEditedTime: entity.last_edited_time,
      properties: entity.properties,
      title: entity.title,
      parent: entity.parent
        ? this.createNodeId(`${entity.parent.object}:${entity.parent.id}`)
        : null,
      children: entity.children.map(({ object, id }) =>
        this.createNodeId(`${object}:${id}`),
      ),
      internal: {
        contentDigest: this.createContentDigest({
          id: entity.id,
          lastEditedTime: entity.last_edited_time,
        }),
        ...internal,
      },
    };
  }

  /**
   * find new entities
   * @param oldMap the old entity map generated from earlier data
   * @param newMap the new entity map computed from up-to-date data from Notion
   * @returns a list of new entities
   */
  private findNewEntities(
    oldMap: Map<string, NormalisedEntity>,
    newMap: Map<string, NormalisedEntity>,
  ): NormalisedEntity[] {
    const added: NormalisedEntity[] = [];
    for (const [id, newEntity] of newMap.entries()) {
      const oldEntity = oldMap.get(id);
      if (!oldEntity) {
        added.push(newEntity);
      }
    }

    return added;
  }

  /**
   * find removed entities
   * @param oldMap the old entity map generated from earlier data
   * @param newMap the new entity map computed from up-to-date data from Notion
   * @returns a list of removed entities
   */
  private findRemovedEntities(
    oldMap: Map<string, NormalisedEntity>,
    newMap: Map<string, NormalisedEntity>,
  ): NormalisedEntity[] {
    const removed: NormalisedEntity[] = [];

    for (const [id, oldEntity] of oldMap.entries()) {
      if (!newMap.has(id)) {
        removed.push(oldEntity);
      }
    }

    return removed;
  }

  /**
   * find updated entities
   * @param oldMap the old entity map generated from earlier data
   * @param newMap the new entity map computed from up-to-date data from Notion
   * @returns a list of updated entities
   */
  private findUpdatedEntities(
    oldMap: Map<string, NormalisedEntity>,
    newMap: Map<string, NormalisedEntity>,
  ): NormalisedEntity[] {
    const updated: NormalisedEntity[] = [];

    for (const [id, newEntity] of newMap.entries()) {
      const oldEntity = oldMap.get(id);
      if (
        oldEntity &&
        oldEntity.last_edited_time !== newEntity.last_edited_time
      ) {
        updated.push(newEntity);
      }
    }

    return updated;
  }

  /**
   * convert an entity to a NodeInput
   * @param entity the entity to be converted
   * @returns converted entity ready to be consumed by gatsby
   */
  private nodifyEntity(entity: NormalisedEntity): NodeInput {
    switch (entity.object) {
      case 'database':
        return this.createDatabaseNode(entity);
      case 'page':
        return this.createPageNode(entity);
      /* istanbul ignore next */
      default:
        throw new TypeError(`unable to process ${JSON.stringify(entity)}`);
    }
  }
}

/**
 * attach parent-child relationship to gatsby node
 * @param entities all sort of entities including database and page
 * @returns a map of entities with parent and children linked
 */
export function computeEntityMap(
  entities: FullEntity[],
): Map<string, NormalisedEntity> {
  // create a new working set
  const map = new Map<string, NormalisedEntity>();
  for (const entity of entities) {
    map.set(`${entity.object}:${entity.id}`, {
      ...entity,
      parent: normaliseParent(entity.parent),
      children: [],
    });
  }

  for (const { id, parent, object } of entities) {
    const child = { object, id };
    switch (parent.type) {
      case 'database_id':
        map.get(`database:${parent.database_id}`)?.children.push(child);
        break;
      case 'page_id':
        map.get(`page:${parent.page_id}`)?.children.push(child);
        break;
      case 'workspace':
        // do nothing
        break;
      /* istanbul ignore next */
      default:
        throw new TypeError(`unknown parent type from ${object}:${id}`);
    }
  }

  return map;
}

/**
 * transform the parent field to an unified format
 * @param parent the parent field returned from Notion API
 * @returns information about the parent in an unified format
 */
export function normaliseParent(parent: FullEntity['parent']): Link | null {
  switch (parent.type) {
    case 'database_id':
      return { object: 'database', id: parent.database_id };
    case 'page_id':
      return { object: 'page', id: parent.page_id };
    case 'workspace':
      return null;
    /* istanbul ignore next */
    default:
      throw new TypeError(`unknown parent`);
  }
}
