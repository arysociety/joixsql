import _ from 'lodash'
import knex from 'knex'

import Is from './is'
import Get from './get'

import { 
    DEFAULT_SQL_TYPES,
    MYSQL_NUMBER_TYPES,
    MYSQL_STRING_TYPES
} from '../mysql-types'

export default class Element {
    private _element: any
    private _is: Is
    private _key: string
    private _get: Get
    private _knexCO: knex

    constructor(element: any, key: string, knexCO: knex){
        this._element = element
        this._key = key
        this._knexCO = knexCO
        this._is = new Is(this)
        this._get = new Get(this)
    }

    public element = () => this._element
    public flags = () => this.element().flags
    public rules = () => this.element().rules
    public type = () => this.element().type
    public allow = () => this.element().allow
    public key = () => this._key

    public is = () => this._is
    public get = () => this._get
    public knex = (): knex => this._knexCO

    public addColumnOptions = (column: knex.ColumnBuilder, columnSTR: any) => {
     
        if (this.is().unique()){
            column = column.unique()
            columnSTR.string += '.unique()'
        }
        if (this.is().primaryKey()){
            column = column.primary()
            columnSTR.string += '.primary()'
        }
        if (this.is().foreignKey()){
            const [table, key] = this.get().foreignKey()
            column = column.references(key).inTable(table)
            columnSTR.string += `.references('${key}').inTable('${table}')`
        }
        if (this.is().defaultValue()){
            const initialDefaultValue = this.get().defaultValue()
            let defaultValue = initialDefaultValue

            if (this.is().date() && initialDefaultValue === 'now'){
                columnSTR.string += `.defaultTo(${initialDefaultValue === 'now' ? (this.is().dateUnix() ? `knex.fn.now()` : `knex.raw('now()')`) : `'${initialDefaultValue}'`})`
                defaultValue = this.is().dateUnix() ? this.knex().fn.now() : this.knex().raw(`now()`)
            } else {
                columnSTR.string += `.defaultTo('${defaultValue}')`
            }
            column = column.defaultTo(defaultValue)
        }
        if (this.is().required()){
            column = column.notNullable()
            columnSTR.string += `.notNullable()`
        }
        if (this.is().deleteCascade()){
            column = column.onDelete('CASCADE')
            columnSTR.string += `.onDelete('CASCADE')`
        }
        if (this.is().updateCascade()){
            column = column.onUpdate('CASCADE')
            columnSTR.string += `.onUpdate('CASCADE')`
        }
    }

    public parse = (column: knex.TableBuilder, columnSTR: any): knex.ColumnBuilder => {
        const typeParses: any = {
            number: this.parseNumber,
            string: this.parseString,
            date: this.parseDate,
            boolean: this.parseBoolean,
        }
        return typeParses[this.type()](column, columnSTR)
    }

    public parseBoolean = (column: knex.TableBuilder, columnSTR: any): knex.ColumnBuilder => {
        columnSTR.string += `.boolean('${this.key()}')`
        return column.boolean(this.key())
    }

    public parseDate = (column: knex.TableBuilder, columnSTR: any): knex.ColumnBuilder => {
        if (this.is().dateUnix()){
            columnSTR.string += `.timestamp('${this.key()}')`
            return column.timestamp(this.key())
        }
        columnSTR.string += `.dateTime('${this.key()}')`
        return column.dateTime(this.key())
    }

    public parseNumber = (column: knex.TableBuilder, columnSTR: any): knex.ColumnBuilder => {

        if (this.is().float() || this.is().precisionSet()){
            columnSTR.string += `.float('${this.key()}', ${this.get().precision() ? this.get().precision() : '8'}, 2)`
            return column.float(this.key(), this.get().precision() | 8, 2)
        }
        if (this.is().double()){
            columnSTR.string += `.specificType('${this.key()}', 'DOUBLE${this.is().strictlyPositive() ? ' UNSIGNED' :''}')`
            return column.specificType(this.key(),`DOUBLE${this.is().strictlyPositive() ? ' UNSIGNED' :''}`)
        }
        if (this.is().portSet()){
            columnSTR.string += `.integer('${this.key()}').unsigned()`
            return column.integer(this.key()).unsigned()
        }

        let minimum: any, maximum: any;
        let type = _.find(DEFAULT_SQL_TYPES, {key: 'number'}).type

        minimum = this.get().greater() || minimum
        maximum = this.get().less() || maximum
        maximum = this.get().max() || maximum
        minimum = this.get().min() || minimum

        if (minimum == undefined)
            minimum = this.is().strictlyPositive() ? 0 : _.find(MYSQL_NUMBER_TYPES, {type: 'int'}).min
        if (maximum == undefined)
            maximum = _.find(MYSQL_NUMBER_TYPES, {type: 'int'}).max

        const isUnsigned = minimum >= 0 
        const isMinBiggest = (Math.max(Math.abs(minimum), Math.abs(maximum)) * -1 === minimum)
        const e = _.find(MYSQL_NUMBER_TYPES, (o) => isMinBiggest ? minimum >= o.min : maximum <= o.max)
        if (!e)
            type = `double${isUnsigned ? ` unsigned`: ''}`
        else 
            type = `${e.type}${isUnsigned ? ` unsigned` : ''}`
        columnSTR.string += `.specificType('${this.key()}', '${type}')`
        return column.specificType(this.key(), type)
    }

    public parseString = (column: knex.TableBuilder, columnSTR: any): knex.ColumnBuilder => {

        if (this.is().enum()){
            columnSTR.string += `.enum('${this.key()}', [${this.allow().map((v: string) => `'${v}'`).join(',')}])`    
            return column.enum(this.key(), this.allow())
        }
        
        else if (this.is().maxSet()){
            const max = this.get().max()
            if (max <= MYSQL_STRING_TYPES[0].max){
                columnSTR.string += `.string('${this.key()}', ${max})`
                return column.string(this.key(), max)
            } else {
                columnSTR.string += `.text('${this.key()}', ${max > MYSQL_STRING_TYPES[1].max ? `'longtext'` : `'mediumtext'`})`
                return column.text(this.key(), max > MYSQL_STRING_TYPES[1].max ? `'longtext'` : `'mediumtext'`)
            }
        } 

        else {
            const max = this.get().stringLengthByType()
            if (max > MYSQL_STRING_TYPES[0].max || max == -1){
                columnSTR.string += `.text('${this.key()}', ${max == -1 ? 'text' : (max > MYSQL_STRING_TYPES[1].max ? `'longtext'` : `'mediumtext'`)})`
                return column.text(this.key(), max == -1 ? 'text' : (max > MYSQL_STRING_TYPES[1].max ? `'longtext'` : `'mediumtext'`))
            }
            else {
                columnSTR.string += `.string('${this.key()}', ${max})`
                return column.string(this.key(), max)
            }
        }
    }

}