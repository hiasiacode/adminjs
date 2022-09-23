import {
  ActionJSON,
  CurrentAdmin,
} from '@adminjs/common/interfaces'
import { ForbiddenError, ConfigurationError } from '@adminjs/common/errors'

import AdminJS from '../../adminjs'
import BaseResource from '../../adapters/resource/base-resource'
import {
  Action,
  IsFunction,
  ActionContext,
  ActionRequest,
  ActionResponse,
  After,
  Before,
  ActionHandler,
} from '../../actions/action.interface'
import BaseRecord from '../../adapters/record/base-record'
import actionErrorHandler from '../../services/action-error-handler/action-error-handler'

/**
 * Decorates an action
 *
 * @category Decorators
 */
class ActionDecorator {
  public name: string

  private _admin: AdminJS

  private _resource: BaseResource

  private action: Action<ActionResponse>

  /**
   * @param {Object}        params
   * @param {Action}        params.action
   * @param {BaseResource}  params.resource
   * @param {AdminJS}      params.admin  current instance of AdminJS
   */
  constructor({ action, admin, resource }: {
    action: Action<ActionResponse>;
    admin: AdminJS;
    resource: BaseResource;
  }) {
    if (!action.actionType) {
      throw new ConfigurationError(
        `action: "${action.name}" does not have an "actionType" property`,
        'Action',
      )
    }
    this.name = action.name
    this._admin = admin
    this._resource = resource

    /**
     * Original action object
     * @type {Action}
     */
    this.action = action
  }

  /**
   * Original handler wrapped with the hook `before` and `after` methods.
   *
   * @param {ActionRequest} request
   * @param {any} response
   * @param {ActionContext} context
   *
   * @return {Promise<any>}
   */
  async handler(
    request: ActionRequest,
    response: any,
    context: ActionContext,
  ): Promise<any> {
    try {
      const modifiedRequest = await this.invokeBeforeHook(request, context)
      this.canInvokeAction(context)
      const res = await this.invokeHandler(modifiedRequest, response, context)
      return this.invokeAfterHook(res, modifiedRequest, context)
    } catch (error) {
      return actionErrorHandler(error, context)
    }
  }

  /**
   * Invokes before action hooks if there are any
   *
   * @param {ActionRequest} request
   * @param {ActionContext} context
   *
   * @return {Promise<ActionRequest>}
   */
  async invokeBeforeHook(request: ActionRequest, context: ActionContext): Promise<ActionRequest> {
    if (!this.action.before) {
      return request
    }
    if (typeof this.action.before === 'function') {
      return this.action.before(request, context)
    }
    if (Array.isArray(this.action.before)) {
      return (this.action.before as Array<Before>).reduce((prevPromise, hook) => (
        prevPromise.then((modifiedRequest) => (
          hook(modifiedRequest, context)
        ))
      ), Promise.resolve(request))
    }
    throw new ConfigurationError(
      'Before action hook has to be either function or Array<function>',
      'Action#Before',
    )
  }

  /**
   * Invokes action handler if there is any
   *
   * @param {ActionRequest} request
   * @param {any} response
   * @param {ActionContext} context
   *
   * @return {Promise<ActionResponse>}
   */
  async invokeHandler(
    request: ActionRequest,
    response: any,
    context: ActionContext,
  ): Promise<ActionResponse> {
    if (typeof this.action.handler === 'function') {
      return this.action.handler(request, response, context)
    }
    if (Array.isArray(this.action.handler)) {
      return (this.action.handler as Array<ActionHandler<ActionResponse>>)
        .reduce((prevPromise, handler) => (
          prevPromise.then(() => (
            handler(request, response, context)
          ))
        ), Promise.resolve({}))
    }
    throw new ConfigurationError(
      'Action handler has to be either function or Array<function>',
      'Action#Before',
    )
  }

  /**
   * Invokes after action hooks if there are any
   *
   * @param {ActionResponse} response
   * @param {ActionRequest} request
   * @param {ActionContext} context
   *
   * @return {Promise<ActionResponse>}
   */
  async invokeAfterHook(
    response: ActionResponse,
    request: ActionRequest,
    context: ActionContext,
  ): Promise<ActionResponse> {
    if (!this.action.after) {
      return response
    }
    if (typeof this.action.after === 'function') {
      return this.action.after(response, request, context)
    }
    if (Array.isArray(this.action.after)) {
      return (this.action.after as Array<After<ActionResponse>>).reduce((prevPromise, hook) => (
        prevPromise.then((modifiedResponse) => (
          hook(modifiedResponse, request, context)
        ))
      ), Promise.resolve(response))
    }
    throw new ConfigurationError(
      'After action hook has to be either function or Array<function>',
      'Action#After',
    )
  }

  /**
   * Returns true when action can be performed on a record
   *
   * @return  {Boolean}
   */
  isRecordType(): boolean {
    return this.action.actionType.includes('record')
  }

  /**
   * Returns true when action can be performed on an entire resource
   *
   * @return  {Boolean}
   */
  isResourceType(): boolean {
    return this.action.actionType.includes('resource')
  }

  /**
   * Returns true when action can be performed on selected records
   *
   * @return  {Boolean}
   */
  isBulkType(): boolean {
    return this.action.actionType.includes('bulk')
  }

  is(what: 'isAccessible' | 'isVisible', currentAdmin?: CurrentAdmin, record?: BaseRecord): boolean {
    if (!['isAccessible', 'isVisible'].includes(what)) {
      throw new Error(`'what' has to be either "isAccessible" or "isVisible". You gave ${what}`)
    }
    let isAction
    if (typeof this.action[what] === 'function') {
      isAction = (this.action[what] as IsFunction)({
        resource: this._resource,
        record,
        action: this,
        currentAdmin,
        _admin: this._admin,
      } as unknown as ActionContext)
    } else if (typeof this.action[what] === 'undefined') {
      isAction = true
    } else {
      isAction = this.action[what]
    }
    return isAction
  }

  /**
   * Is action visible in the UI
   * @param {CurrentAdmin} [currentAdmin]   currently logged in admin user
   * @param {BaseRecord} [record]
   *
   * @return  {Boolean}
   */
  isVisible(currentAdmin?: CurrentAdmin, record?: BaseRecord): boolean {
    return this.is('isVisible', currentAdmin, record)
  }

  /**
   * Is action accessible
   *
   * @param {CurrentAdmin} [currentAdmin]   currently logged in admin user
   * @param {BaseRecord} [record]
   * @return  {Boolean}
   */
  isAccessible(currentAdmin?: CurrentAdmin, record?: BaseRecord): boolean {
    return this.is('isAccessible', currentAdmin, record)
  }

  /**
   * Indicates if user can invoke given action
   *
   * @param   {ActionContext}  context  passed action context
   *
   * @return  {boolean}                 true given user has rights to the action
   * @throws  {ForbiddenError}          when user cannot perform given action
   */
  canInvokeAction(context: ActionContext): boolean {
    const { record, records, currentAdmin, resource } = context

    if (record && this.isAccessible(currentAdmin, record)) {
      return true
    }

    if (records && !records.find((bulkRecord) => !this.isAccessible(currentAdmin, bulkRecord))) {
      return true
    }

    if (!record && !records && this.isAccessible(currentAdmin)) {
      return true
    }

    throw new ForbiddenError(
      'forbiddenError',
      { resourceId: resource.decorate().id(), actionName: this.name },
    )
  }

  hasHandler(): boolean {
    return !!this.action.handler
  }

  /**
   * Serializes action to JSON format
   *
   * @param {CurrentAdmin} [currentAdmin]
   *
   * @return  {ActionJSON}  serialized action
   */
  toJSON(): ActionJSON {
    const resourceId = this._resource._decorated?.id?.() || this._resource.id()
    return {
      name: this.action.name,
      actionType: this.action.actionType,
      resourceId,
      hasHandler: this.hasHandler(),
    }
  }
}

export default ActionDecorator
