const BaseBot = require('bot-sdk')
const Chatbot = require('darwin-sdk').Chatbot
const Query = require('darwin-sdk').Query
const OpenSkillEvent = require('darwin-sdk').OpenSkillEvent
const QuitSkillEvent = require('darwin-sdk').QuitSkillEvent
const PlayFinishEvent = require('darwin-sdk').PlayFinishEvent
const Response = require('darwin-sdk').Response
const Request = require('bot-sdk/lib/Request')
const request_http = require('request')
const config = require('../config')
const logger = require('../utils/logger').logger('bot')

const index = async (ctx, next) => {
    await ctx.render('index.html')
};

class Bot extends BaseBot {
    constructor(postData) {
        super(postData)

        const request = new Request(postData)
        const botId = request.getBotId()
        this.agent = config.agents[botId].name
        this.title = config.agents[botId].title
        this.background = config.agents[botId].background
        this.userId = 'dueros_' + request.getUserId()

        if (!this.agent) {
            logger.error('bot id does not register agent: ' + botId)
        }

        const chatbot = new Chatbot(config.chatbot_url, this.agent, config.source)

        this.addLaunchHandler(async () => {
            this.waitAnswer()
            const event = new OpenSkillEvent(this.userId)
            event.setDisplay(this.isSupportDisplay())
            const chatbotReply = await chatbot.dispose(event)
            return await this.buildResponse(chatbotReply)
        });

        this.addIntentHandler('ai.dueros.common.default_intent', async () => {
            this.waitAnswer()
            const query = new Query(this.userId, request.getQuery())
            query.setDisplay(this.isSupportDisplay())
            const chatbotReply = await chatbot.dispose(query)
            return await this.buildResponse(chatbotReply)
        });
        
        this.addSessionEndedHandler(async () => {
            this.setExpectSpeech(false)
            this.endDialog()
            const event = new QuitSkillEvent(this.userId)
            event.setDisplay(this.isSupportDisplay())
            const chatbotReply = await chatbot.dispose(event)
            return await this.buildResponse(chatbotReply)
        })

        this.addEventListener('AudioPlayer.PlaybackFinished', async () => {
            this.waitAnswer()
            const event = new PlayFinishEvent(this.userId, request.getQuery())
            event.setDisplay(this.isSupportDisplay())
            const chatbotReply = await chatbot.dispose(event)
            return await this.buildResponse(chatbotReply)            
        });

        this.addDefaultEventListener(async () => {
            this.setExpectSpeech(false)
            this.waitAnswer()
            return {
            }
        })        
    }

    getQrcodeImageUrl() {
        return new Promise( (resolve, reject) => { 
            request_http({ method : 'GET', uri : config.wechat_url + `/qrcode?scene=${this.userId}&source=dueros`}, 
                (err, res, body) => {
                    if (!err && res.statusCode == 200) {
                        resolve(config.wechat_url + JSON.parse(body).url);
                    } else {
                        reject(err);
                    }
                }
            )
        });
    }

    async buildResponse(chatbotReply) {
        if (this.shouldDisplayQrcode(chatbotReply)) {
            let reply = '请使用微信扫描二维码，打开小程序进行课程的录制和修改。'
            this.setExpectSpeech(false)
            return {
                directives: [this.getTextTemplateWithImage(reply, await this.getQrcodeImageUrl())],
                outputSpeech: reply
            }
        }

        if (chatbotReply.hasInstructOfQuit()) {
            this.setExpectSpeech(false)
            this.endDialog()
        }
       
        return {
            directives: this.getDirectives(chatbotReply),
            outputSpeech: chatbotReply.getReply()
        }
    }

    shouldDisplayQrcode(chatbotReply) {
        if (!this.isSupportDisplay() || this.agent != 'course-record') return false
        return (chatbotReply.getReply().indexOf('哒尔文') != -1)
    }

    getDirectives(chatbotReply) {
        const directives = []
        const instructs = chatbotReply.getInstructs()
        if (this.isSupportDisplay()) {
            directives.push(this.getTextTemplate(chatbotReply.getReply()))
        }
        if (!instructs) return directives
        for (let instruct of instructs) {
            if (instruct.type === 'play-audio') {
                const Play = BaseBot.Directive.AudioPlayer.Play
                this.setExpectSpeech(false)
                // dueros only support to play audio url of https
                directives.push(new Play(instruct['url'].replace('https', 'http'), Play.REPLACE_ALL))
                // only support play one audio in directives
                break
            }
        }
        return directives
    }

    getTextTemplate(text) {
        let bodyTemplate = new BaseBot.Directive.Display.Template.BodyTemplate1();
        bodyTemplate.setTitle(this.title);
        bodyTemplate.setPlainTextContent(text);
        bodyTemplate.setBackGroundImage(this.background);
        let renderTemplate = new BaseBot.Directive.Display.RenderTemplate(bodyTemplate);
        return renderTemplate;
    }

    getTextTemplateWithImage(text, image) {
        let bodyTemplate = new BaseBot.Directive.Display.Template.BodyTemplate2();
        bodyTemplate.setTitle(this.title);
        bodyTemplate.setPlainContent(text);
        bodyTemplate.setImage(image, 100, 100);
        bodyTemplate.setBackGroundImage(this.background);
        let renderTemplate = new BaseBot.Directive.Display.RenderTemplate(bodyTemplate);
        return renderTemplate;
    }
}

const postQuery = async (ctx, next) => {
    const request = ctx.request.body
    logger.debug(`receive : ${JSON.stringify(request)}`)
    const bot = new Bot(ctx.request.body)
    const response = await bot.run()
    logger.debug(`reply : ${JSON.stringify(response)}`)
    ctx.response.type = "application/json"
    ctx.response.status = 200
    ctx.response.body = response
};

module.exports = {
    'GET /': index,
    'POST /': postQuery
};
