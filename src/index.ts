import { reverse } from 'dns'
import { Context, Schema } from 'koishi'
import { platform, type } from 'os'
import { getuid } from 'process'
import { scheduler } from 'timers/promises'
import { deflate } from 'zlib'
import {} from 'koishi-plugin-scoreboard-service'

export const name = 'scoreboard'

export interface Config {
  超级管理员:string[]
  自我繁殖:boolean
  自相残杀:boolean

}

export const Config: Schema<Config> = Schema.object({
  超级管理员:Schema.array(Schema.string())
    .description("允许管理计分板的人，每个项目放一个ID"),
  自我繁殖:Schema.boolean()
    .description("允许计分管理员添加其他计分管理员")
    .default(false),
  自相残杀:Schema.boolean()
    .description("允许计分管理员移除其他计分管理员")
    .default(false)
})

export const inject = ['database', "scoreboard"]

export const usage = `
## 如果你是旧版本用户，你需要将scoreboard表内的内容迁移至scoreboardData表，并将groupName字段填入“默认”

使用方法： 

添加玩家 <@某人> [积分] （不传入积分时默认为0）  

删除玩家 <@某人>  

增减积分 <+/-数字> <...玩家> （调整玩家的积分，可批量更改）  

设定积分 <数字> <...玩家> （设定玩家的积分为指定数值，可批量更改）  

查询积分 [分页] （按分数降序或升序输出该群的计分板，默认为降序；可指定分页，一页五个玩家）
  可选参数：-r 升序输出计分板  

添加计分管理员 <@某人> （将指定用户添加为该群的计分板管理员）

移除计分管理员 <@某人> （将指定用户移除出该群的计分板管理员）

除查询积分外，均需要超级管理员或计分管理员权限（可在配置页面设置或群内添加）
除添加/移除计分管理员外，均有可选选项-g，可指定操作的分组，不指定时为默认
`

declare module 'koishi' {
  interface Tables {
      scoreboardAdmins: ScoreboardAdmins
  }
}


export interface ScoreboardAdmins {
  guildId: string;
  adminId: string[];
  id: number;
}


export function apply(ctx: Context, config: Config) {
  extendTable(ctx);

  ctx.guild().command("计分板", "通用计分");

  ctx.guild().command("计分板").subcommand(".添加玩家 <player:string> [score:number]", "添加玩家和积分", {checkArgCount: true}).alias("添加玩家")
    .option("group", '-g <group>')
    .example("计分板.添加玩家 @某人 114")
    .action(async ({session, options}, player, score) => {
      if (config.超级管理员.includes(session.event.user.id)) {
        if (!/at/.test(player)) {
          return "你没有at到人"
        }
        let qqnum = /[0-9]+/.exec(player)[0];
        let scoreData = await ctx.scoreboard.get(options.group ?? "默认", qqnum)   
        if (scoreData === undefined) {
          let userData;
          if (session.platform !== "red") userData = await session.bot.getGuildMember(session.event.guild.id, qqnum)
          await ctx.scoreboard.set(
            session.event.guild.id, 
            options.group ?? "默认",
            qqnum, 
            score || 0, 
            session.elements[1].attrs.name ?? (userData.name || userData.user.name),
          )
          if (!userData) userData = {name: session.elements[1].attrs.name}
          return `
  操作成功，新增内容：
  玩家昵称：${userData.name || userData.user.name}
  玩家ID：${qqnum}
  分组：${options.group ?? "默认"}
  积分：${score || 0}
  `
        } else {
          return `
  操作失败，该玩家已存在
  积分：${scoreData[0].score}
  `
        }
      } else {
        return "你的权限不足"
      }
    })
  
  ctx.guild().command("计分板").subcommand(".增减积分 <score:number> <...player:string>", "更改玩家的积分，可批量更改", {checkArgCount: true}).alias("增减积分")
    .option("group", '-g <group>')
    .example("计分板.增减积分 -10 @koishi @shigma")
    .action(async ({session, options}, score, ...player) => {
      if (config.超级管理员.includes(session.event.user.id)) {
        console.log(session.elements)
        let result = []

        for (let i = 0; i < player.length; i++) {
          if (!/<at id="/.test(player[i])) {
            result.push("这里没at到人")
            continue
          }
          let qqnum = /(?<=id=")[^"]*(?=")/.exec(player[i])[0];
          let userData;
          if (session.platform === "red") {
            userData = {name: /(?<=name=")[^"]*(?=")/.exec(player[i])[0]}
          } else {
            userData = await session.bot.getGuildMember(session.event.guild.id, qqnum)
          }
          let scoreData = await ctx.scoreboard.get(
            session.event.guild.id,
            options.group ?? "默认",
            qqnum
          )
          if (scoreData === undefined) {
            result.push(`玩家"${userData.name || userData.user.name}"不存在，已忽略`)
          } else {
            await ctx.scoreboard.set(session.event.guild.id, options.group ?? "默认", qqnum, scoreData[0].score + score)
            result.unshift(`玩家"${userData.name || userData.user.name}" 积分${score >= 0 ? "+" + score : score}\n当前积分：${scoreData[0].score + score}`)
          }
        }
  
        return result.join("\n---------------\n")
      } else {
        return "你的权限不足"
      }
      
    })

  ctx.guild().command("计分板").subcommand(".设定积分 <score:number> <...player:string>", "设定玩家的积分，可批量设定", {checkArgCount: true}).alias("设定积分")
    .option("group", '-g <group>')
    .example("计分板.设定积分 114 @koishi @shigma")
    .action(async ({session, options}, score, ...player) => {
      if (config.超级管理员.includes(session.event.user.id)) {
        let result = []

        for (let i = 0; i < player.length; i++) {
          if (!/at/.test(player[i])) {
            result.push("这里没at到人")
            continue
          }
          let qqnum = /(?<=id=")[^"]*(?=")/.exec(player[i])[0];
          let userData;
          if (session.platform === "red") {
            userData = {name: /(?<=name=")[^"]*(?=")/.exec(player[i])[0]}
          } else {
            userData = await session.bot.getGuildMember(session.event.guild.id, qqnum)
          }
          let scoreData = await ctx.scoreboard.get(
            session.event.guild.id, 
            options.group ?? "默认", 
            qqnum,
          )
          if (scoreData === undefined) {
            result.push(`玩家"${userData.name || userData.user.name}"不存在，已忽略`)
          } else {
            await ctx.scoreboard.set(
              session.event.guild.id,
              options.group ?? "默认",
              qqnum,
              score
            )
            result.unshift(`玩家"${userData.name || userData.user.name}"\n原积分：${scoreData[0].score}\n当前积分：${score}`)
          }
        }
  
        return result.join("\n---------------\n")
      } else {
        return "你的权限不足"
      }
      
    })
  
  ctx.guild().command("计分板").subcommand(".查询积分 [page:number]", "按排序输出计分板").alias("查询积分")
    .usage("可指定分页（一页五个玩家），默认为按分数降序输出")
    .option("group", '-g <group>')
    .option("reversed", "-r 升序输出计分板")
    .action(async ({session, options}, page) => {
      let result = []
      let scoreData = await ctx.scoreboard.getBySort(
        session.event.guild.id,
        options.group ?? "默认",
        5,
        ((page ?? 0) - 1) * 5,
        options.reversed
      )
      if (scoreData.length === 0) {
        return "当前分页为空\n\n分组：" + (options.group ?? "默认")
      } else {
        for (let i of scoreData) {
          let userData;
          if (session.platform === "red") {
            userData = {name: i.playerName}
          } else {
            userData = await session.bot.getGuildMember(session.event.guild.id, i.playerId)
          }
          result.push(`玩家：${userData.name || userData.user.name}(${i.playerId})\n积分：${i.score}`)
        }
        return result.join("\n---------------\n") + "\n\n分组：" + (options.group ?? "默认")
      }
    })

  ctx.guild().command("计分板").subcommand(".删除玩家 <player:string>", "在计分板中删除一个玩家", {checkArgCount: true}).alias("删除玩家")
    .option("group", '-g <group>')
    .example("计分板.删除玩家 @koishi")
    .action(async ({session, options}, player) => {
      if (config.超级管理员.includes(session.event.user.id)) {
        if (!/at/.test(player)) {
          return "你没有at到人"
        }
        let qqnum = session.elements[1].attrs.id;
        let userData;
        if (session.platform === "red") {
          userData = {name: session.elements[1].attrs.name}
        } else {
          userData = await session.bot.getGuildMember(session.event.guild.id, qqnum)
        }
        let success = await ctx.scoreboard.remove(session.event.guild.id, options.group ?? "默认", qqnum)
        if (!success) {
          return "操作失败，找不到该玩家"
        }
      } else {
        return "你的权限不足"
      }
    })

  ctx.guild().command("计分板").subcommand(".清空计分板").alias("清空计分板")
    .option("group", '-g <group>')
    .action(async ({session, options}) => {
      if (config.超级管理员.includes(session.event.user.id)) {
        session.send("你确定要清空计分板吗，不能还原！（确定/取消）")
        switch (await session.prompt(30000)) {
          case "确定":
            await ctx.scoreboard.clear(options.group ?? "默认", session.event.guild.id)
            return "已清空当前群的计分板"
          case "取消":
            return "已取消"
          case undefined:
            return "回复超时，已取消"
          default:
            return "回复内容不合法，已取消"
        }
      } else {
        return "你的权限不足"
      }
    })

  ctx.guild().command("计分板").subcommand(".添加计分管理员 <user:string>").alias("添加计分管理员")
    .action(async ({session}, user) => {
      let admins = await getAdmins(ctx, session)
      let qqnum = session.elements[1].attrs.id;
      if ( !((config.超级管理员.includes(session.event.user.id)) || (config.自我繁殖 && admins?.includes(session.event.user.id))) ) {
        return "你的权限不足"
      } else if (!/at/.test(user)) {
        return "你没有at到人"
      } else if (admins === undefined){
        ctx.model.create("scoreboardAdmins", {
          guildId: session.event.guild.id,
          adminId: qqnum
        })
        return "添加成功"
      } else if (admins?.includes(qqnum[0])) {
        return "该管理员已存在"
      } else {
        admins.push(qqnum[0])
        ctx.model.set("scoreboardAdmins", {guildId: session.event.guild.id}, {
          adminId: admins
        })
        return "添加成功"
      }
    })

    ctx.guild().command("计分板").subcommand(".移除计分管理员 <user:string>").alias("移除计分管理员")
    .action(async ({session}, user) => {
      let admins = await getAdmins(ctx, session)
      let qqnum = session.elements[1].attrs.id;
      if ( !((config.超级管理员.includes(session.event.user.id)) || (config.自相残杀 && admins?.includes(session.event.user.id))) ) {
        return "你的权限不足"
      } else if (!/at/.test(user)) {
        return "你没有at到人"
      } else if (!admins?.includes(qqnum[0])) {
        return "该管理员不存在"
      } else {
        let pos = admins.indexOf(qqnum[0])
        admins.splice(pos, 1)
        await ctx.database.set("scoreboardAdmins", {guildId: session.event.guild.id}, {
          adminId: admins
        })
        return "移除成功"
      }
      
    })

    

}


async function getAdmins(ctx, session) {
  return (await ctx.model.get("scoreboardAdmins", {
    guildId: session.event.guild.id,
  }))[0]?.adminId
}

async function extendTable(ctx) {
  await ctx.model.extend("scoreboardAdmins", {
    id: "unsigned",
    guildId: "text",
    adminId: "list"
  }, {primary: 'id', autoInc: true})
}
