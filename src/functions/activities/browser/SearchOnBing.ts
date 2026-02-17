import type { AxiosRequestConfig } from 'axios'
import type { Page } from 'patchright'
import * as fs from 'fs'
import path from 'path'

import { Workers } from '../../Workers'
import { QueryCore } from '../../QueryEngine'

import type { BasePromotion } from '../../../interface/DashboardData'

export class SearchOnBing extends Workers {
    private bingHome = 'https://bing.com'

    private cookieHeader: string = ''

    private fingerprintHeader: { [x: string]: string } = {}

    private gainedPoints: number = 0

    private success: boolean = false

    private oldBalance: number = this.bot.userData.currentPoints

    public async doSearchOnBing(promotion: BasePromotion, page: Page) {
        const offerId = promotion.offerId
        this.oldBalance = Number(this.bot.userData.currentPoints ?? 0)

        this.bot.logger.info(
            this.bot.isMobile,
            'SEARCH-ON-BING',
            `开始必应搜索 | offerId=${offerId} | 标题="${promotion.title}" | 当前积分=${this.oldBalance}`
        )

        try {
            this.cookieHeader = this.bot.browser.func.buildCookieHeader(
                this.bot.isMobile ? this.bot.cookies.mobile : this.bot.cookies.desktop, [
                    'bing.com',
                    'live.com',
                    'microsoftonline.com'
                ]
            )

            const fingerprintHeaders = { ...this.bot.fingerprint.headers }
            delete fingerprintHeaders['Cookie']
            delete fingerprintHeaders['cookie']
            this.fingerprintHeader = fingerprintHeaders

            this.bot.logger.debug(
                this.bot.isMobile,
                'SEARCH-ON-BING',
                `为必应搜索准备的头部信息 | offerId=${offerId} | cookie长度=${this.cookieHeader.length} | 指纹头键数=${Object.keys(this.fingerprintHeader).length}`
            )

            this.bot.logger.debug(this.bot.isMobile, 'SEARCH-ON-BING', `激活搜索任务 | offerId=${offerId}`)

            const activated = await this.activateSearchTask(promotion)
            if (!activated) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'SEARCH-ON-BING',
                    `搜索活动无法激活，正在中止 | offerId=${offerId}`
                )
                return
            }

            // 在这里进行必应搜索
            const queries = await this.getSearchQueries(promotion)

            // 执行查询
            await this.searchBing(page, queries)

            if (this.success) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'SEARCH-ON-BING',
                    `完成必应搜索 | offerId=${offerId} | 起始余额=${this.oldBalance} | 最终余额=${this.bot.userData.currentPoints}`
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'SEARCH-ON-BING',
                    `必应搜索失败 | offerId=${offerId} | 起始余额=${this.oldBalance} | 最终余额=${this.bot.userData.currentPoints}`
                )
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'SEARCH-ON-BING',
                `doSearchOnBing中出现错误 | offerId=${promotion.offerId} | 消息=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private async searchBing(page: Page, queries: string[], retryCount: number = 0) {
        queries = [...new Set(queries)]
        const maxRetries = 2

        // 检查页面是否已关闭
        if (!page || page.isClosed()) {
            this.bot.logger.error(this.bot.isMobile, 'SEARCH-ON-BING-SEARCH', '页面已关闭，无法执行搜索')
            return
        }

        this.bot.logger.debug(
            this.bot.isMobile,
            'SEARCH-ON-BING-SEARCH',
            `开始搜索循环 | 查询数量=${queries.length} | 旧余额=${this.oldBalance} | 重试=${retryCount}/${maxRetries}`
        )

        let i = 0

        while (i < queries.length) {
            // 检查页面是否已关闭
            if (!page || page.isClosed()) {
                this.bot.logger.error(this.bot.isMobile, 'SEARCH-ON-BING-SEARCH', '页面已关闭，无法执行搜索')
                return
            }

            const query = queries[i]
            try {
                this.bot.logger.debug(this.bot.isMobile, 'SEARCH-ON-BING-SEARCH', `处理查询 | 查询="${query}"`)

                // 使用传入的page参数而不是mainMobilePage，确保页面上下文一致
                await page.goto(this.bingHome, { 
                    waitUntil: 'networkidle',
                    timeout: 20000 
                }).catch((error) => {
                    this.bot.logger.warn(this.bot.isMobile, 'SEARCH-ON-BING-SEARCH', `导航失败，尝试刷新: ${error instanceof Error ? error.message : String(error)}`)
                    // 检查页面是否已关闭
                    if (!page || page.isClosed()) {
                        throw new Error('页面已关闭')
                    }
                    return page.reload({ waitUntil: 'domcontentloaded' })
                })

                // 等待页面加载完成
                await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

                // 关闭所有弹出消息
                await this.bot.browser.utils.tryDismissAllMessages(page)

                // 等待搜索框出现
                const searchBar = '#sb_form_q'
                const searchBox = page.locator(searchBar)
                await searchBox.waitFor({ state: 'visible', timeout: 20000 })

                // 清除并填写搜索框
                await this.bot.utils.wait(800)
                await page.fill(searchBar, '').catch(() => {})
                await this.bot.utils.wait(500)
                await page.keyboard.type(query || 'Microsoft Rewards', { delay: 30 }).catch(() => {})
                await this.bot.utils.wait(1000)

                // 提交搜索
                await page.keyboard.press('Enter')

                // 等待搜索结果加载
                await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
                
                // 增加页面停留时间，模拟真实用户行为
                await this.bot.utils.wait(this.bot.utils.randomDelay(8000, 12000))

                // 更真实的页面交互，包括随机点击搜索结果
                await this.simulateUserBehavior(page)

                // 多次检查积分更新，因为积分可能需要一些时间才能更新
                let gainedPoints = 0
                let retryChecks = 8 // 增加检查次数
                while (retryChecks > 0) {
                    try {
                        const newBalance = await this.bot.browser.func.getCurrentPoints()
                        gainedPoints = newBalance - this.oldBalance

                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'SEARCH-ON-BING-SEARCH',
                            `查询后余额检查 | 查询="${query}" | 旧余额=${this.oldBalance} | 新余额=${newBalance} | 获得积分=${gainedPoints} | 剩余检查=${retryChecks-1}`
                        )

                        if (gainedPoints > 0) {
                            this.bot.userData.currentPoints = newBalance
                            this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints

                            this.bot.logger.info(
                                this.bot.isMobile,
                                'SEARCH-ON-BING-SEARCH',
                                `必应搜索查询完成 | 查询="${query}" | 获得积分=${gainedPoints} | 旧余额=${this.oldBalance} | 新余额=${newBalance}`,
                                'green'
                            )

                            this.success = true
                            return
                        }
                    } catch (error) {
                        this.bot.logger.warn(this.bot.isMobile, 'SEARCH-ON-BING-SEARCH', `积分检查失败: ${error instanceof Error ? error.message : String(error)}`)
                    }

                    retryChecks--
                    if (retryChecks > 0) {
                        await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 8000)) // 增加等待时间
                    }
                }

                // 无积分获取，继续下一个查询
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'SEARCH-ON-BING-SEARCH',
                    `${i+1}/${queries.length} | 无积分=1 | 查询="${query}"`
                )
                i++
            } catch (error) {
                this.bot.logger.error(
                    this.bot.isMobile,
                    'SEARCH-ON-BING-SEARCH',
                    `搜索循环期间出错 | 查询="${query}" | 消息=${error instanceof Error ? error.message : String(error)}`
                )
                // 出错时尝试下一个查询
                i++
            }
        }

        // 如果所有查询都失败，尝试使用活动标题作为查询
        if (!this.success && retryCount < maxRetries) {
            // 检查页面是否已关闭
            if (!page || page.isClosed()) {
                this.bot.logger.error(this.bot.isMobile, 'SEARCH-ON-BING-SEARCH', '页面已关闭，无法执行重试')
                return
            }

            const nextRetryCount = retryCount + 1
            this.bot.logger.info(
                this.bot.isMobile,
                'SEARCH-ON-BING-SEARCH',
                `所有查询失败，尝试使用通用查询 (重试 ${nextRetryCount}/${maxRetries})`
            )
            
            // 生成更相关的通用查询
            const simpleQueries = [
                'Microsoft Rewards points',
                'Bing search rewards',
                'Microsoft products 2026',
                'Windows 11 features',
                'Microsoft Edge browser',
                'Microsoft 365 subscription',
                'Bing AI chat',
                'Microsoft Copilot'
            ]
            
            await this.searchBing(page, simpleQueries, nextRetryCount)
        }

        if (!this.success) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'SEARCH-ON-BING-SEARCH',
                `完成所有查询但未获得积分 | 尝试查询数=${queries.length} | 旧余额=${this.oldBalance} | 最终余额=${this.bot.userData.currentPoints}`
            )
        }
    }

    // 模拟真实用户行为
    private async simulateUserBehavior(page: Page) {
        try {
            // 随机滚动页面，模拟用户浏览
            for (let scroll = 0; scroll < 5; scroll++) {
                const scrollAmount = Math.random() * 800
                await page.evaluate((amount) => {
                    window.scrollTo({ top: window.scrollY + amount, behavior: 'smooth' })
                }, scrollAmount).catch(() => {})
                await this.bot.utils.wait(this.bot.utils.randomDelay(1000, 2000))
            }

            // 随机点击一个搜索结果
            const searchResults = page.locator('div#b_results > li.b_algo')
            const resultCount = await searchResults.count()
            
            if (resultCount > 0) {
                const randomIndex = Math.floor(Math.random() * Math.min(5, resultCount))
                const randomResult = searchResults.nth(randomIndex)
                
                if (await randomResult.isVisible()) {
                    await this.bot.utils.wait(this.bot.utils.randomDelay(500, 1000))
                    await randomResult.click().catch(() => {})
                    await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 5000))
                    
                    // 返回到搜索结果页面
                    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
                    await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 3000))
                }
            }

            // 再次滚动页面
            await page.evaluate(() => {
                window.scrollTo({ top: Math.random() * 500, behavior: 'smooth' })
            }).catch(() => {})
            await this.bot.utils.wait(this.bot.utils.randomDelay(1000, 2000))
        } catch (error) {
            this.bot.logger.debug(this.bot.isMobile, 'SEARCH-ON-BING-SEARCH', `模拟用户行为失败: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    // 任务需要在能够完成之前被激活
    private async activateSearchTask(promotion: BasePromotion): Promise<boolean> {
        try {
            this.bot.logger.debug(
                this.bot.isMobile,
                'SEARCH-ON-BING-ACTIVATE',
                `准备激活请求 | offerId=${promotion.offerId} | 哈希=${promotion.hash}`
            )

            const formData = new URLSearchParams({
                id: promotion.offerId,
                hash: promotion.hash,
                timeZone: '60',
                activityAmount: '1',
                dbs: '0',
                form: '',
                type: '',
                __RequestVerificationToken: this.bot.requestToken
            })

            const request: AxiosRequestConfig = {
                url: 'https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest',
                method: 'POST',
                headers: {
                    ...(this.bot.fingerprint?.headers ?? {}),
                    Cookie: this.cookieHeader,
                    Referer: 'https://rewards.bing.com/',
                    Origin: 'https://rewards.bing.com'
                },
                data: formData
            }

            const response = await this.bot.axios.request(request)
            this.bot.logger.info(
                this.bot.isMobile,
                'SEARCH-ON-BING-ACTIVATE',
                `成功激活活动 | 状态=${response.status} | offerId=${promotion.offerId}`
            )
            return true
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'SEARCH-ON-BING-ACTIVATE',
                `激活失败 | offerId=${promotion.offerId} | 消息=${error instanceof Error ? error.message : String(error)}`
            )
            return false
        }
    }

    private async getSearchQueries(promotion: BasePromotion): Promise<string[]> {
        interface Queries {
            title: string
            queries: string[]
        }

        let queries: Queries[] = []

        try {
            if (this.bot.config.searchOnBingLocalQueries) {
                this.bot.logger.debug(this.bot.isMobile, 'SEARCH-ON-BING-QUERY', '使用本地查询配置文件')

                const data = fs.readFileSync(path.join(__dirname, '../bing-search-activity-queries.json'), 'utf8')
                queries = JSON.parse(data)

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-ON-BING-QUERY',
                    `已加载查询配置 | 来源=本地 | 条目数=${queries.length}`
                )
            } else {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-ON-BING-QUERY',
                    '从远程仓库获取查询配置'
                )

                // 直接从仓库获取，这样用户不需要重新下载脚本来获取新活动
                const response = await this.bot.axios.request({
                    method: 'GET',
                    url: 'https://raw.githubusercontent.com/TheNetsky/Microsoft-Rewards-Script/refs/heads/v3/src/functions/bing-search-activity-queries.json'
                })
                queries = response.data

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-ON-BING-QUERY',
                    `已加载查询配置 | 来源=远程 | 条目数=${queries.length}`
                )
            }

            const answers = queries.find(
                x => this.bot.utils.normalizeString(x.title) === this.bot.utils.normalizeString(promotion.title)
            )

            if (answers && answers.queries.length > 0) {
                const answer = this.bot.utils.shuffleArray(answers.queries)

                this.bot.logger.info(
                    this.bot.isMobile,
                    'SEARCH-ON-BING-QUERY',
                    `找到活动标题的答案 | 来源=${this.bot.config.searchOnBingLocalQueries ? 'local' : 'remote'} | 标题="${promotion.title}" | 答案数量=${answer.length} | 第一个查询="${answer[0]}"`
                )

                return answer
            } else {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'SEARCH-ON-BING-QUERY',
                    `查询配置中没有匹配的标题 | 来源=${this.bot.config.searchOnBingLocalQueries ? 'local' : 'remote'} | 标题="${promotion.title}"`
                )

                const queryCore = new QueryCore(this.bot)

                const promotionDescription = promotion.description.toLowerCase().trim()
                const queryDescription = promotionDescription.replace('search on bing', '').trim()

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-ON-BING-QUERY',
                    `请求必应建议 | 查询描述="${queryDescription}"`
                )

                const bingSuggestions = await queryCore.getBingSuggestions(queryDescription)

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-ON-BING-QUERY',
                    `必应建议结果 | 数量=${bingSuggestions.length} | 标题="${promotion.title}"`
                )

                // 如果未找到建议
                if (!bingSuggestions.length) {
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'SEARCH-ON-BING-QUERY',
                        `未找到建议，回退到活动标题 | 标题="${promotion.title}"`
                    )
                    return [promotion.title]
                } else {
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'SEARCH-ON-BING-QUERY',
                        `使用必应建议作为搜索查询 | 数量=${bingSuggestions.length} | 标题="${promotion.title}"`
                    )
                    return bingSuggestions
                }
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'SEARCH-ON-BING-QUERY',
                `解析搜索查询时出错 | 标题="${promotion.title}" | 消息=${error instanceof Error ? error.message : String(error)} | 回退=活动标题`
            )
            return [promotion.title]
        }
    }
}
